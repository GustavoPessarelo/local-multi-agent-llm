"""Worker persistente de chat e redes multiagente locais."""
from __future__ import annotations

import json
import re
from time import monotonic

from django.conf import settings
from django.db import close_old_connections, transaction
from django.utils import timezone

from .local_llm import complete, stream_chat
from .memory import memory_context
from .models import AuditEvent, ChatRun, MemoryEntry, Message, ToolDefinition, ToolInvocation
from .profiling import write_profile


TERMINAL = {"completed", "cancelled", "failed"}
TRACE_TEXT_LIMIT = 12_000


def trace_text(value: object, limit: int = TRACE_TEXT_LIMIT) -> str:
    """Mantém a trilha útil sem duplicar conteúdos potencialmente enormes."""
    text = str(value or "")
    return text if len(text) <= limit else text[:limit] + "\n… [conteúdo truncado]"


def trace_agents(events: list[dict]) -> list[dict]:
    agents: list[dict] = []
    seen: set[str] = set()
    for event in events:
        if event.get("type") != "agent_started":
            continue
        agent_id = str(event.get("agentId", ""))
        if not agent_id or agent_id in seen:
            continue
        seen.add(agent_id)
        agents.append({"id": agent_id, "name": str(event.get("agentName") or agent_id)})
    return agents


def append_event(run: ChatRun, event_type: str, **payload) -> dict:
    run.refresh_from_db(fields=["events"])
    events = list(run.events or [])
    event = {"id": (events[-1]["id"] + 1 if events else 1), "type": event_type, "at": timezone.now().isoformat(), **payload}
    events.append(event)
    run.events = events[-2000:]
    run.save(update_fields=["events"])
    return event


def cancellation_requested(run: ChatRun) -> bool:
    return ChatRun.objects.filter(id=run.id, cancel_requested=True).exists()


def _finalize(run: ChatRun, status: str, output: str = "", error: str = "") -> None:
    run.status = status
    run.output = output
    run.error = error
    run.current_agent = ""
    run.completed_at = timezone.now()
    run.save(update_fields=["status", "output", "error", "current_agent", "completed_at"])
    try:
        run.profiling_file = write_profile(run)
        if run.profiling_file:
            run.save(update_fields=["profiling_file"])
    except Exception as profile_error:
        append_event(run, "profiling_failed", error=str(profile_error))


def _cancel(run: ChatRun) -> None:
    run.refresh_from_db(fields=["status", "output", "profiling_enabled", "profiling_file", "started_at", "completed_at"])
    if run.status == "cancelled":
        return
    append_event(run, "cancelled", message="Execução interrompida pelo usuário.")
    _finalize(run, "cancelled", run.output)


def _tool_request(run: ChatRun) -> bool:
    existing = run.tool_invocations.order_by("-created_at").first()
    if existing:
        if existing.status == "pending":
            run.status = "awaiting_approval"
            run.save(update_fields=["status"])
            return True
        return False
    if not run.enabled_tools or not run.conversation.project.resources.exists():
        return False
    task = run.user_message.content.lower() if run.user_message_id else ""
    cues = ("arquivo", "documento", "resource", "csv", "planilha", "tabela", "dados", "pandas", "ler ", "leia ", "consulta", "query")
    if not any(cue in task for cue in cues):
        return False
    allowed = list(ToolDefinition.objects.filter(name__in=run.enabled_tools, enabled=True))
    if not allowed:
        return False
    descriptions = [{"name": tool.name, "description": tool.description, "input_schema": tool.input_schema} for tool in allowed]
    resources = [{"id": item.id, "name": item.name} for item in run.conversation.project.resources.all()]
    try:
        raw = complete(run.model, [
            {"role": "system", "content": "Decida se uma tool é necessária. Responda somente JSON: {\"tool\": nome-ou-null, \"arguments\": {}}. Tools: " + json.dumps(descriptions, ensure_ascii=False) + ". Resources: " + json.dumps(resources, ensure_ascii=False)},
            {"role": "user", "content": run.user_message.content},
        ])
        match = re.search(r"\{.*\}", raw, re.S)
        decision = json.loads(match.group(0) if match else raw)
        tool = next((item for item in allowed if item.name == decision.get("tool")), None)
        if not tool:
            return False
        arguments = dict(decision.get("arguments") or {})
    except Exception:
        tool = next((item for item in allowed if item.name == "pandas_profile_csv"), allowed[0])
        resource = run.conversation.project.resources.first()
        arguments = {"resource_id": resource.id}
        if tool.name == "duckdb_query_csv":
            arguments["query"] = "SELECT * FROM source LIMIT 50"
    if cancellation_requested(run):
        return False
    invocation = ToolInvocation.objects.create(
        project=run.conversation.project, conversation=run.conversation, chat_run=run,
        tool=tool, arguments=arguments, status="pending",
    )
    append_event(run, "tool_approval_required", invocationId=invocation.id, tool=tool.name, arguments=arguments)
    run.status = "awaiting_approval"
    run.save(update_fields=["status"])
    return True


def _history(run: ChatRun) -> list[dict]:
    history = [
        {"role": message.role, "content": message.content}
        for message in run.conversation.messages.exclude(role="tool").order_by("created_at")
    ]
    invocation = run.tool_invocations.filter(status="completed").order_by("-created_at").first()
    if invocation:
        history.append({"role": "user", "content": f"Resultado verificado da tool {invocation.tool.name}:\n{json.dumps(invocation.result, ensure_ascii=False)}"})
    return history


def _stream_response(run: ChatRun, messages: list[dict], expose: bool = True) -> str:
    assembled = ""
    pending = ""
    last_flush = monotonic()

    def cancelled():
        return cancellation_requested(run)

    for delta in stream_chat(run.model, messages, should_cancel=cancelled):
        if not run.first_token_at:
            run.first_token_at = timezone.now()
            run.save(update_fields=["first_token_at"])
        assembled += delta
        pending += delta
        if expose and (len(pending) >= 80 or monotonic() - last_flush > 0.35):
            append_event(run, "delta", content=pending)
            pending = ""
            last_flush = monotonic()
    if expose and pending:
        append_event(run, "delta", content=pending)
    return assembled


def _execute_single(run: ChatRun) -> str:
    started = monotonic()
    objective = run.user_message.content if run.user_message_id else ""
    append_event(
        run, "agent_started", agentId="single", agentName="Agente", depth=0,
        message="Agente local analisando a solicitação.", objective=trace_text(objective),
        instruction="Responder diretamente à conversa usando o modelo local.",
        availableDelegations=[], memoryPreview="Memória incorporada ao histórico da conversa quando aplicável.",
    )
    output = _stream_response(run, _history(run))
    append_event(
        run, "agent_completed", agentId="single", agentName="Agente", decision="final",
        result=trace_text(output), durationMs=round((monotonic() - started) * 1000), delegated=False,
    )
    return output


def _parse_agent_result(text: str, allowed: set[str]) -> tuple[str | None, str]:
    match = re.match(r"\s*DELEGATE\s*:?\s*([A-Za-z0-9_-]+)\s*(?:\n|$)(.*)", text, re.I | re.S)
    if match and match.group(1) in allowed:
        task = re.sub(r"^TASK\s*:?\s*", "", match.group(2).strip(), flags=re.I)
        return match.group(1), task
    final = re.sub(r"^\s*FINAL\s*:?\s*", "", text, count=1, flags=re.I)
    return None, final.strip()


def _execute_flow(run: ChatRun) -> str:
    graph = run.flow_version.graph
    nodes = {str(node["id"]): node for node in graph.get("nodes", [])}
    root_id = str(graph.get("rootId", ""))
    if root_id not in nodes:
        raise ValueError("O flow não possui um agente root válido.")
    edges = list(graph.get("edges", []))
    current_id = root_id
    delegated_task = run.user_message.content
    prior_outputs: list[str] = []
    visits: dict[str, int] = {}
    tool_result = run.tool_invocations.filter(status="completed").order_by("-created_at").first()
    for depth in range(8):
        if cancellation_requested(run):
            return ""
        node = nodes[current_id]
        visits[current_id] = visits.get(current_id, 0) + 1
        if visits[current_id] > 2:
            raise ValueError("O flow excedeu o limite de repetição de um agente.")
        run.current_agent = current_id
        run.save(update_fields=["current_agent"])
        targets = [str(edge["target"]) for edge in edges if str(edge.get("source")) == current_id and str(edge.get("target")) in nodes]
        target_help = "\n".join(f"- {target}: {nodes[target]['name']} — {nodes[target].get('systemPrompt', '')[:240]}" for target in targets)
        delegation = (
            "\nVocê pode delegar somente aos agentes abaixo. Para delegar, responda exatamente com 'DELEGATE <id>' na primeira linha e a tarefa na linha seguinte. "
            "Para concluir, responda com 'FINAL' na primeira linha e a resposta final depois.\n" + target_help
            if targets else "\nVocê é o agente final. Responda com 'FINAL' na primeira linha e a resposta completa depois."
        )
        memory = memory_context(run.conversation.project, delegated_task, ["episodic", "long_term", "project"])
        context = "\n\n".join(prior_outputs[-3:]) or "Nenhuma saída anterior."
        if tool_result:
            context += f"\n\nResultado da tool {tool_result.tool.name}: {json.dumps(tool_result.result, ensure_ascii=False)}"
        system = f"Você é {node['name']}.\n{node.get('systemPrompt', '')}{delegation}\nNão invente resultados de tools."
        user = f"Solicitação atual:\n{delegated_task}\n\nContexto de outros agentes:\n{context}\n\nMemória relevante:\n{memory or 'Nenhuma'}"
        agent_started = monotonic()
        append_event(
            run, "agent_started", agentId=current_id, agentName=node["name"], depth=depth,
            message=f"{node['name']} está analisando a solicitação.",
            objective=trace_text(delegated_task), instruction=trace_text(node.get("systemPrompt", "")),
            contextPreview=trace_text(context, 4_000), memoryPreview=trace_text(memory or "Nenhuma", 4_000),
            availableDelegations=[{"id": target, "name": nodes[target]["name"]} for target in targets],
            tool=str(tool_result.tool.name) if tool_result else None,
        )
        raw = _stream_response(run, [{"role": "system", "content": system}, {"role": "user", "content": user}], expose=False)
        target, content = _parse_agent_result(raw, set(targets))
        append_event(
            run, "agent_completed", agentId=current_id, agentName=node["name"], delegated=bool(target),
            decision="delegate" if target else "final", targetAgentId=target,
            targetAgentName=nodes[target]["name"] if target else None,
            result=trace_text(content), rawProtocol=trace_text(raw, 2_000),
            durationMs=round((monotonic() - agent_started) * 1000),
        )
        if target:
            append_event(run, "delegated", fromAgentId=current_id, fromAgentName=node["name"], toAgentId=target, toAgentName=nodes[target]["name"], message=f"{node['name']} delegou para {nodes[target]['name']}.")
            prior_outputs.append(f"{node['name']}: {content or delegated_task}")
            delegated_task = content or delegated_task
            current_id = target
            continue
        append_event(run, "delta", content=content)
        return content
    raise ValueError("O flow excedeu o limite máximo de 8 delegações.")


def execute_chat_run(run_id: int) -> None:
    close_old_connections()
    run = ChatRun.objects.select_related("conversation__project", "flow_version__flow", "user_message").get(id=run_id)
    if run.cancel_requested:
        _cancel(run)
        return
    run.status = "running"
    run.started_at = run.started_at or timezone.now()
    run.error = ""
    run.save(update_fields=["status", "started_at", "error"])
    append_event(run, "run_started", model=run.model, flowId=run.flow_version.flow_id if run.flow_version_id else None)
    try:
        if _tool_request(run):
            if cancellation_requested(run):
                _cancel(run)
            return
        if cancellation_requested(run):
            _cancel(run)
            return
        output = _execute_flow(run) if run.flow_version_id else _execute_single(run)
        if cancellation_requested(run):
            _cancel(run)
            return
        run.refresh_from_db(fields=["events"])
        message = Message.objects.create(
            conversation=run.conversation, role="assistant", content=output,
            metadata={
                "chatRunId": run.id,
                "flowId": run.flow_version.flow_id if run.flow_version_id else None,
                "flowName": run.flow_version.flow.name if run.flow_version_id else None,
                "traceAgents": trace_agents(run.events or []),
                "traceStatus": "completed",
            },
        )
        run.output = output
        append_event(run, "completed", messageId=message.id)
        _finalize(run, "completed", output)
        if run.flow_version_id:
            MemoryEntry.objects.create(
                project=run.conversation.project, conversation=run.conversation, kind="episodic",
                content=f"Tarefa: {run.user_message.content}\nResultado: {output[:12000]}",
                source_type="chat_run", source_id=str(run.id),
                metadata={"flow": run.flow_version.flow.name, "version": run.flow_version.version},
            )
        AuditEvent.objects.create(project=run.conversation.project, event_type="chat_run_completed", payload={"run_id": run.id})
    except Exception as error:
        append_event(run, "failed", error=str(error))
        _finalize(run, "failed", run.output, str(error))
    finally:
        close_old_connections()


def claim_next_run() -> int | None:
    with transaction.atomic():
        run = ChatRun.objects.filter(status="queued").order_by("created_at").first()
        if not run:
            return None
        updated = ChatRun.objects.filter(id=run.id, status="queued").update(status="running")
        return run.id if updated else None


def request_cancel(run: ChatRun) -> None:
    if run.status in TERMINAL:
        return
    previous_status = run.status
    run.cancel_requested = True
    run.status = "cancelling"
    run.save(update_fields=["cancel_requested", "status"])
    run.tool_invocations.filter(status="pending").update(status="declined", completed_at=timezone.now())
    append_event(run, "cancelling", message="Cancelamento solicitado.")
    if run.started_at is None or previous_status == "awaiting_approval":
        _cancel(run)
