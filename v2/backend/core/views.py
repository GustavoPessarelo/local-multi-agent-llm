from __future__ import annotations

import json
import mimetypes
import shutil
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.http import JsonResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST
from django.utils import timezone
from pydantic import ValidationError

from .contracts import ChatInput, ToolDecision
from .local_llm import complete, list_models, stream_chat
from .memory import create_memory, search_project, serialize_memory
from .models import AuditEvent, Conversation, Flow, FlowRun, FlowVersion, MemoryEntry, Message, Project, Resource, ToolDefinition, ToolInvocation
from .orchestration import FLOW_TEMPLATES, start_flow_run, validate_graph
from .tools import ensure_builtin_tools, execute


def data(request) -> dict:
    try:
        return json.loads(request.body or "{}")
    except json.JSONDecodeError as error:
        raise ValueError("JSON inválido.") from error


def serialize_project(project: Project) -> dict:
    return {"id": project.id, "name": project.name, "createdAt": project.created_at.isoformat(), "updatedAt": project.updated_at.isoformat()}


def serialize_message(message: Message) -> dict:
    return {"id": message.id, "role": message.role, "content": message.content, "metadata": message.metadata, "createdAt": message.created_at.isoformat()}


def serialize_conversation(conversation: Conversation) -> dict:
    return {"id": conversation.id, "title": conversation.title, "createdAt": conversation.created_at.isoformat(), "updatedAt": conversation.updated_at.isoformat()}


def serialize_flow(flow: Flow, include_graph: bool = False) -> dict:
    value = {"id": flow.id, "name": flow.name, "description": flow.description, "activeVersion": flow.active_version, "updatedAt": flow.updated_at.isoformat()}
    if include_graph and flow.active_version:
        version = flow.versions.get(version=flow.active_version)
        value["graph"] = version.graph
    return value


def serialize_run(run: FlowRun) -> dict:
    pending = run.tool_invocations.filter(status="pending").select_related("tool").first()
    return {
        "id": run.id, "flowId": run.flow_version.flow_id, "version": run.flow_version.version,
        "status": run.status, "task": run.task, "currentNode": run.current_node,
        "trace": run.trace, "output": run.output, "error": run.error,
        "pendingApproval": {"id": pending.id, "tool": pending.tool.name, "arguments": pending.arguments} if pending else None,
        "createdAt": run.created_at.isoformat(),
    }


def serialize_resource(resource: Resource) -> dict:
    return {"id": resource.id, "name": resource.name, "mimeType": resource.mime_type, "sizeBytes": resource.size_bytes, "preview": resource.text_preview, "createdAt": resource.created_at.isoformat()}


def serialize_tool(tool: ToolDefinition) -> dict:
    return {"name": tool.name, "displayName": tool.display_name, "description": tool.description, "inputSchema": tool.input_schema, "requiresApproval": tool.requires_approval, "enabled": tool.enabled, "version": tool.version}


def tool_decision(model: str, history: list[dict], project: Project, enabled_tools: list[str]) -> ToolDecision:
    allowed = list(ToolDefinition.objects.filter(name__in=enabled_tools, enabled=True))
    descriptions = [{"name": tool.name, "description": tool.description, "input_schema": tool.input_schema} for tool in allowed]
    resources = [{"id": item.id, "name": item.name} for item in project.resources.all()]
    schema = {
        "type": "json_schema",
        "json_schema": {
            "name": "tool_decision",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {"type": {"type": "string", "enum": ["assistant", "tool_call"]}, "response": {"type": "string"}, "tool": {"type": ["string", "null"]}, "arguments": {"type": "object"}},
                "required": ["type", "response", "tool", "arguments"],
                "additionalProperties": False,
            },
        },
    }
    instructions = {
        "role": "system",
        "content": "Você é um agente local. Escolha no máximo uma tool somente se ela for necessária. Responda estritamente com o JSON do schema. Tools permitidas: " + json.dumps(descriptions, ensure_ascii=False) + ". Resources disponíveis: " + json.dumps(resources, ensure_ascii=False),
    }
    raw = complete(model, [instructions, *history], response_format=schema)
    decision = ToolDecision.model_validate_json(raw)
    if decision.type == "tool_call" and decision.tool not in {tool.name for tool in allowed}:
        raise ValueError("O modelo solicitou uma tool que não está habilitada.")
    return decision


@require_GET
def health(request):
    return JsonResponse({"ok": True, "provider": "local-openai-compatible"})


@require_GET
def models(request):
    try:
        return JsonResponse(list_models())
    except Exception as error:
        return JsonResponse({"error": f"Modelo local indisponível: {error}"}, status=503)


@csrf_exempt
def projects(request):
    if request.method == "GET":
        return JsonResponse({"projects": [serialize_project(project) for project in Project.objects.all()]})
    if request.method != "POST":
        return JsonResponse({"error": "Método não permitido."}, status=405)
    try:
        name = str(data(request).get("name", "")).strip()
        if not name or len(name) > 120:
            raise ValueError("Nome de projeto inválido.")
        project = Project.objects.create(name=name)
        (settings.DATA_ROOT / "projects" / str(project.id)).mkdir(parents=True, exist_ok=True)
        AuditEvent.objects.create(project=project, event_type="project_created", payload={"name": name})
        return JsonResponse({"project": serialize_project(project)}, status=201)
    except ValueError as error:
        return JsonResponse({"error": str(error)}, status=400)


@csrf_exempt
def project_detail(request, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    if request.method != "DELETE":
        return JsonResponse({"error": "Método não permitido."}, status=405)
    projects_root = (settings.DATA_ROOT / "projects").resolve()
    project_root = (projects_root / str(project.id)).resolve()
    if project_root.parent != projects_root:
        return JsonResponse({"error": "Diretório do projeto inválido."}, status=400)
    project.delete()
    warning = ""
    if project_root.is_dir():
        try:
            shutil.rmtree(project_root)
        except OSError as error:
            warning = f"O projeto foi removido do banco, mas alguns arquivos não puderam ser apagados: {error}"
    return JsonResponse({"deleted": True, "id": project_id, "warning": warning})


@csrf_exempt
def conversations(request, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    if request.method == "GET":
        records = [serialize_conversation(item) for item in project.conversations.all()]
        return JsonResponse({"conversations": records})
    if request.method != "POST":
        return JsonResponse({"error": "Método não permitido."}, status=405)
    title = str(data(request).get("title", "Nova conversa")).strip()[:160] or "Nova conversa"
    conversation = Conversation.objects.create(project=project, title=title)
    return JsonResponse({"conversation": serialize_conversation(conversation)}, status=201)


@csrf_exempt
def conversation_detail(request, conversation_id: int):
    conversation = get_object_or_404(Conversation, id=conversation_id)
    if request.method == "DELETE":
        project_id = conversation.project_id
        conversation.delete()
        return JsonResponse({"deleted": True, "id": conversation_id, "projectId": project_id})
    if request.method != "PATCH":
        return JsonResponse({"error": "Método não permitido."}, status=405)
    try:
        title = str(data(request).get("title", "")).strip()
        if not title or len(title) > 160:
            raise ValueError("O nome da conversa deve ter entre 1 e 160 caracteres.")
        conversation.title = title
        conversation.save(update_fields=["title", "updated_at"])
        AuditEvent.objects.create(project=conversation.project, event_type="conversation_renamed", payload={"conversation_id": conversation.id, "title": title})
        return JsonResponse({"conversation": serialize_conversation(conversation)})
    except (ValueError, TypeError) as error:
        return JsonResponse({"error": str(error)}, status=400)


def should_consider_tools(conversation: Conversation, enabled_tools: list[str]) -> bool:
    if not enabled_tools or not conversation.project.resources.exists():
        return False
    last_message = conversation.messages.filter(role="user").order_by("-created_at").values_list("content", flat=True).first() or ""
    terms = ("arquivo", "documento", "resource", "csv", "planilha", "tabela", "dados", "pandas", "ler ", "leia ", "consulta", "query")
    return any(term in last_message.lower() for term in terms)


@csrf_exempt
def messages(request, conversation_id: int):
    conversation = get_object_or_404(Conversation, id=conversation_id)
    if request.method == "GET":
        return JsonResponse({"messages": [serialize_message(item) for item in conversation.messages.all()]})
    if request.method != "POST":
        return JsonResponse({"error": "Método não permitido."}, status=405)
    try:
        payload = ChatInput.model_validate(data(request))
    except (ValidationError, ValueError) as error:
        return JsonResponse({"error": str(error)}, status=400)

    Message.objects.create(conversation=conversation, role="user", content=payload.content)
    if conversation.title == "Nova conversa":
        compact = " ".join(payload.content.split())
        conversation.title = compact[:64] + ("…" if len(compact) > 64 else "")
        conversation.save(update_fields=["title", "updated_at"])
    history = [{"role": message.role, "content": message.content} for message in conversation.messages.exclude(role="tool").order_by("created_at")]
    model = payload.model or settings.LOCAL_LLM_DEFAULT_MODEL

    def event(name: str, value: dict):
        return f"event: {name}\ndata: {json.dumps(value, ensure_ascii=False)}\n\n"

    def generate():
        assembled = ""
        try:
            yield event("run_started", {"conversationId": conversation.id, "model": model})
            # A decisão estruturada de tool exige uma segunda inferência completa. Só a
            # fazemos quando há recursos e o pedido sugere de fato acesso a eles.
            if should_consider_tools(conversation, payload.enabled_tools):
                try:
                    decision = tool_decision(model, history, conversation.project, payload.enabled_tools)
                    if decision.type == "tool_call" and decision.tool:
                        tool = ToolDefinition.objects.get(name=decision.tool, enabled=True)
                        invocation = ToolInvocation.objects.create(project=conversation.project, conversation=conversation, tool=tool, arguments=decision.arguments, status="pending")
                        AuditEvent.objects.create(project=conversation.project, event_type="tool_requested_by_agent", payload={"invocation_id": invocation.id, "tool": tool.name})
                        yield event("approval_required", {"invocationId": invocation.id, "tool": tool.name, "arguments": invocation.arguments})
                        return
                    assembled = decision.response
                    assistant = Message.objects.create(conversation=conversation, role="assistant", content=assembled)
                    yield event("delta", {"content": assembled})
                    yield event("completed", {"message": serialize_message(assistant)})
                    return
                except Exception:
                    # Modelos locais sem JSON Schema continuam usando o caminho de chat normal.
                    pass
            for delta in stream_chat(model, history):
                assembled += delta
                yield event("delta", {"content": delta})
            assistant = Message.objects.create(conversation=conversation, role="assistant", content=assembled)
            AuditEvent.objects.create(project=conversation.project, event_type="chat_completed", payload={"conversation_id": conversation.id, "message_id": assistant.id, "model": model})
            yield event("completed", {"message": serialize_message(assistant)})
        except Exception as error:
            yield event("failed", {"error": str(error)})

    response = StreamingHttpResponse(generate(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


@csrf_exempt
def resources(request, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    if request.method == "GET":
        return JsonResponse({"resources": [serialize_resource(item) for item in project.resources.all()]})
    if request.method != "POST":
        return JsonResponse({"error": "Método não permitido."}, status=405)
    upload = request.FILES.get("file")
    if upload is None:
        return JsonResponse({"error": "Envie um arquivo no campo file."}, status=400)
    if upload.size > settings.MAX_UPLOAD_BYTES:
        return JsonResponse({"error": "Arquivo excede 20 MB."}, status=400)
    safe_name = Path(upload.name).name
    relative_path = f"resources/{uuid4().hex}-{safe_name}"
    destination = settings.DATA_ROOT / "projects" / str(project.id) / relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as output:
        for chunk in upload.chunks():
            output.write(chunk)
    preview = destination.read_text(encoding="utf-8", errors="replace")[:2_000] if upload.content_type.startswith("text/") or safe_name.lower().endswith((".csv", ".json", ".md", ".txt")) else ""
    resource = Resource.objects.create(project=project, name=safe_name, relative_path=relative_path, mime_type=upload.content_type or mimetypes.guess_type(safe_name)[0] or "application/octet-stream", size_bytes=upload.size, text_preview=preview)
    AuditEvent.objects.create(project=project, event_type="resource_uploaded", payload={"resource_id": resource.id, "name": safe_name})
    return JsonResponse({"resource": serialize_resource(resource)}, status=201)


@require_GET
def tools(request):
    ensure_builtin_tools()
    return JsonResponse({"tools": [serialize_tool(item) for item in ToolDefinition.objects.filter(enabled=True)]})


@csrf_exempt
@require_POST
def tool_invocations(request, project_id: int):
    ensure_builtin_tools()
    project = get_object_or_404(Project, id=project_id)
    try:
        payload = data(request)
        tool = ToolDefinition.objects.get(name=payload["tool"], enabled=True)
        conversation = Conversation.objects.filter(id=payload.get("conversationId"), project=project).first()
        invocation = ToolInvocation.objects.create(project=project, conversation=conversation, tool=tool, arguments=payload.get("arguments", {}), status="pending")
        AuditEvent.objects.create(project=project, event_type="tool_requested", payload={"invocation_id": invocation.id, "tool": tool.name})
        return JsonResponse({"invocation": {"id": invocation.id, "status": invocation.status, "tool": serialize_tool(tool), "arguments": invocation.arguments}}, status=201)
    except (KeyError, ToolDefinition.DoesNotExist, ValidationError, ValueError) as error:
        return JsonResponse({"error": str(error)}, status=400)


@csrf_exempt
@require_POST
def approve_tool(request, invocation_id: int):
    invocation = get_object_or_404(ToolInvocation, id=invocation_id, status="pending")
    invocation.status = "approved"
    invocation.save(update_fields=["status"])
    AuditEvent.objects.create(project=invocation.project, event_type="tool_approved", payload={"invocation_id": invocation.id})
    try:
        result = execute(invocation)
        assistant = None
        if invocation.conversation_id and not invocation.flow_run_id:
            tool_message = Message.objects.create(conversation=invocation.conversation, role="tool", content=json.dumps(result, ensure_ascii=False), metadata={"tool": invocation.tool.name, "invocation_id": invocation.id})
            history = [{"role": item.role, "content": item.content} for item in invocation.conversation.messages.exclude(role="tool").order_by("created_at")]
            history.append({"role": "user", "content": f"Resultado da tool {invocation.tool.name}:\n{tool_message.content}\n\nResponda ao pedido original usando este resultado."})
            try:
                content = complete(settings.LOCAL_LLM_DEFAULT_MODEL, history)
                assistant = Message.objects.create(conversation=invocation.conversation, role="assistant", content=content)
            except Exception as error:
                assistant = Message.objects.create(conversation=invocation.conversation, role="assistant", content=f"A tool foi concluída, mas o modelo não pôde sintetizar a resposta: {error}")
        if invocation.flow_run_id:
            start_flow_run(invocation.flow_run_id)
        return JsonResponse({"invocation": {"id": invocation.id, "status": invocation.status, "result": result}, "assistant": serialize_message(assistant) if assistant else None, "flowRunId": invocation.flow_run_id})
    except Exception as error:
        invocation.status = "failed"
        invocation.result = {"error": str(error)}
        invocation.completed_at = timezone.now()
        invocation.save(update_fields=["status", "result", "completed_at"])
        AuditEvent.objects.create(project=invocation.project, event_type="tool_failed", payload={"invocation_id": invocation.id, "error": str(error)})
        return JsonResponse({"error": str(error)}, status=400)


@csrf_exempt
@require_POST
def decline_tool(request, invocation_id: int):
    invocation = get_object_or_404(ToolInvocation, id=invocation_id, status="pending")
    invocation.status = "declined"
    invocation.completed_at = timezone.now()
    invocation.save(update_fields=["status", "completed_at"])
    AuditEvent.objects.create(project=invocation.project, event_type="tool_declined", payload={"invocation_id": invocation.id})
    if invocation.flow_run_id:
        start_flow_run(invocation.flow_run_id)
    return JsonResponse({"invocation": {"id": invocation.id, "status": invocation.status}, "flowRunId": invocation.flow_run_id})


@require_GET
def flow_templates(request):
    return JsonResponse({"templates": FLOW_TEMPLATES})


@csrf_exempt
def flows(request, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    if request.method == "GET":
        return JsonResponse({"flows": [serialize_flow(flow) for flow in project.flows.all()]})
    if request.method != "POST":
        return JsonResponse({"error": "Método não permitido."}, status=405)
    try:
        payload = data(request)
        template = next((item for item in FLOW_TEMPLATES if item["key"] == payload.get("templateKey")), None)
        graph = validate_graph(json.loads(json.dumps(template["graph"] if template else payload.get("graph", {}))))
        name = str(payload.get("name") or (template["name"] if template else "Novo fluxo")).strip()[:120]
        description = str(payload.get("description") or (template["description"] if template else "")).strip()[:2_000]
        if not name:
            raise ValueError("Nome do fluxo é obrigatório.")
        flow = Flow.objects.create(project=project, name=name, description=description, active_version=1)
        FlowVersion.objects.create(flow=flow, version=1, graph=graph)
        AuditEvent.objects.create(project=project, event_type="flow_created", payload={"flow_id": flow.id, "template": payload.get("templateKey")})
        return JsonResponse({"flow": serialize_flow(flow, include_graph=True)}, status=201)
    except (ValueError, TypeError, KeyError) as error:
        return JsonResponse({"error": str(error)}, status=400)


@csrf_exempt
def flow_detail(request, flow_id: int):
    flow = get_object_or_404(Flow, id=flow_id)
    if request.method == "GET":
        return JsonResponse({"flow": serialize_flow(flow, include_graph=True)})
    if request.method != "PATCH":
        return JsonResponse({"error": "Método não permitido."}, status=405)
    payload = data(request)
    name = str(payload.get("name", flow.name)).strip()[:120]
    if not name:
        return JsonResponse({"error": "Nome do fluxo é obrigatório."}, status=400)
    flow.name = name
    flow.description = str(payload.get("description", flow.description)).strip()[:2_000]
    flow.save(update_fields=["name", "description", "updated_at"])
    return JsonResponse({"flow": serialize_flow(flow, include_graph=True)})


@csrf_exempt
def flow_versions(request, flow_id: int):
    flow = get_object_or_404(Flow, id=flow_id)
    if request.method == "GET":
        return JsonResponse({"versions": [{"id": item.id, "version": item.version, "graph": item.graph, "createdAt": item.created_at.isoformat()} for item in flow.versions.all()]})
    if request.method != "POST":
        return JsonResponse({"error": "Método não permitido."}, status=405)
    try:
        graph = validate_graph(data(request).get("graph", {}))
        version_number = (flow.versions.order_by("-version").values_list("version", flat=True).first() or 0) + 1
        version = FlowVersion.objects.create(flow=flow, version=version_number, graph=graph)
        flow.active_version = version_number
        flow.save(update_fields=["active_version", "updated_at"])
        AuditEvent.objects.create(project=flow.project, event_type="flow_version_created", payload={"flow_id": flow.id, "version": version_number})
        return JsonResponse({"version": {"id": version.id, "version": version.version, "graph": version.graph}, "flow": serialize_flow(flow)}, status=201)
    except (ValueError, TypeError) as error:
        return JsonResponse({"error": str(error)}, status=400)


@csrf_exempt
def flow_runs(request, flow_id: int):
    flow = get_object_or_404(Flow, id=flow_id)
    if request.method == "GET":
        records = FlowRun.objects.filter(flow_version__flow=flow).select_related("flow_version")[:30]
        return JsonResponse({"runs": [serialize_run(run) for run in records]})
    if request.method != "POST":
        return JsonResponse({"error": "Método não permitido."}, status=405)
    try:
        payload = data(request)
        task = str(payload.get("task", "")).strip()
        if not task or len(task) > 40_000:
            raise ValueError("A tarefa deve ter entre 1 e 40.000 caracteres.")
        version = flow.versions.get(version=flow.active_version)
        conversation = Conversation.objects.filter(id=payload.get("conversationId"), project=flow.project).first()
        run = FlowRun.objects.create(flow_version=version, conversation=conversation, task=task)
        if conversation:
            Message.objects.create(conversation=conversation, role="user", content=task, metadata={"flowRunId": run.id})
            if conversation.title == "Nova conversa":
                compact = " ".join(task.split())
                conversation.title = compact[:64] + ("…" if len(compact) > 64 else "")
                conversation.save(update_fields=["title", "updated_at"])
        AuditEvent.objects.create(project=flow.project, event_type="flow_run_started", payload={"run_id": run.id, "flow_id": flow.id, "version": version.version})
        start_flow_run(run.id)
        return JsonResponse({"run": serialize_run(run)}, status=202)
    except (ValueError, FlowVersion.DoesNotExist) as error:
        return JsonResponse({"error": str(error)}, status=400)


@require_GET
def flow_run_detail(request, run_id: int):
    run = get_object_or_404(FlowRun.objects.select_related("flow_version__flow"), id=run_id)
    return JsonResponse({"run": serialize_run(run)})


@csrf_exempt
def memories(request, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    if request.method == "GET":
        kind = request.GET.get("kind")
        records = project.memories.filter(kind=kind) if kind else project.memories.all()
        return JsonResponse({"memories": [serialize_memory(item) for item in records[:200]]})
    if request.method != "POST":
        return JsonResponse({"error": "Método não permitido."}, status=405)
    try:
        payload = data(request)
        conversation = Conversation.objects.filter(id=payload.get("conversationId"), project=project).first()
        memory = create_memory(project, str(payload.get("kind", "project")), str(payload.get("content", "")), conversation=conversation, source_type="manual")
        AuditEvent.objects.create(project=project, event_type="memory_created", payload={"memory_id": memory.id, "kind": memory.kind})
        return JsonResponse({"memory": serialize_memory(memory)}, status=201)
    except (ValueError, TypeError) as error:
        return JsonResponse({"error": str(error)}, status=400)


@csrf_exempt
def memory_detail(request, memory_id: int):
    memory = get_object_or_404(MemoryEntry, id=memory_id)
    if request.method == "DELETE":
        memory.delete()
        return JsonResponse({"deleted": True})
    if request.method != "PATCH":
        return JsonResponse({"error": "Método não permitido."}, status=405)
    try:
        content = str(data(request).get("content", "")).strip()
        if not content:
            raise ValueError("Conteúdo da memória é obrigatório.")
        memory.content = content[:40_000]
        memory.embedding = []
        memory.save(update_fields=["content", "embedding", "updated_at"])
        return JsonResponse({"memory": serialize_memory(memory)})
    except (ValueError, TypeError) as error:
        return JsonResponse({"error": str(error)}, status=400)


@csrf_exempt
@require_POST
def semantic_search(request, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    payload = data(request)
    return JsonResponse({"results": search_project(project, str(payload.get("query", "")), int(payload.get("limit", 8)))})
