"""Executor local de grafos multiagente com monitoramento persistido."""
from __future__ import annotations

import json
import re
import threading

from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone

from .local_llm import complete
from .memory import memory_context
from .models import AuditEvent, FlowRun, MemoryEntry, Message, ToolDefinition, ToolInvocation


FLOW_TEMPLATES = [
    {
        "key": "planner-executor-reviewer",
        "name": "Planejador → Executor → Revisor",
        "description": "Decompõe a tarefa, produz a solução e faz uma revisão final.",
        "graph": {
            "rootId": "planner",
            "nodes": [
                {"id": "planner", "name": "Planejador", "x": 70, "y": 170, "systemPrompt": "Crie um plano objetivo. Delegue ao Executor quando o plano estiver pronto."},
                {"id": "executor", "name": "Executor", "x": 390, "y": 170, "systemPrompt": "Execute a tarefa com precisão. Delegue ao Revisor para validar a entrega."},
                {"id": "reviewer", "name": "Revisor", "x": 710, "y": 170, "systemPrompt": "Revise o resultado, corrija falhas e produza a resposta final."},
            ],
            "edges": [{"id": "e1", "source": "planner", "target": "executor"}, {"id": "e2", "source": "executor", "target": "reviewer"}],
        },
    },
    {
        "key": "context-router",
        "name": "Roteador contextual",
        "description": "Classifica o pedido e direciona para um agente técnico ou de redação antes da revisão.",
        "graph": {
            "rootId": "router",
            "nodes": [
                {"id": "router", "name": "Roteador", "x": 60, "y": 190, "systemPrompt": "Escolha e delegue ao especialista mais adequado ao pedido."},
                {"id": "technical", "name": "Especialista técnico", "x": 370, "y": 70, "systemPrompt": "Resolva tarefas de código, dados e arquitetura de forma verificável e delegue ao Revisor."},
                {"id": "writer", "name": "Especialista em texto", "x": 370, "y": 310, "systemPrompt": "Produza textos claros e adequados ao público, depois delegue ao Revisor."},
                {"id": "reviewer", "name": "Revisor", "x": 710, "y": 190, "systemPrompt": "Valide a entrega e apresente a resposta final sem mencionar o processo interno."},
            ],
            "edges": [
                {"id": "e1", "source": "router", "target": "technical"}, {"id": "e2", "source": "router", "target": "writer"},
                {"id": "e3", "source": "technical", "target": "reviewer"}, {"id": "e4", "source": "writer", "target": "reviewer"},
            ],
        },
    },
]


def validate_graph(graph: dict) -> dict:
    if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list) or not isinstance(graph.get("edges"), list):
        raise ValueError("O grafo precisa conter nodes e edges.")
    nodes, edges = graph["nodes"], graph["edges"]
    if not 1 <= len(nodes) <= 50 or len(edges) > 100:
        raise ValueError("O grafo deve ter entre 1 e 50 nós e no máximo 100 arestas.")
    ids = [str(node.get("id", "")) for node in nodes]
    if any(not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", item) for item in ids) or len(ids) != len(set(ids)):
        raise ValueError("IDs de nós devem ser únicos e usar letras, números, _ ou -.")
    known = set(ids)
    for node in nodes:
        node["name"] = str(node.get("name") or node["id"])[:120]
        node["systemPrompt"] = str(node.get("systemPrompt") or node.get("prompt", ""))[:12_000]
        node["x"] = max(0, min(float(node.get("x", 0)), 4000))
        node["y"] = max(0, min(float(node.get("y", 0)), 4000))
        for legacy in ("prompt", "model", "tools", "memory", "type"):
            node.pop(legacy, None)
    for edge in edges:
        if edge.get("source") not in known or edge.get("target") not in known or edge.get("source") == edge.get("target"):
            raise ValueError("Aresta inválida.")
    root_id = str(graph.get("rootId", ""))
    if root_id not in known:
        raise ValueError("Defina exatamente um agente root válido.")
    outgoing = {node_id: [] for node_id in known}
    for edge in edges:
        outgoing[edge["source"]].append(edge["target"])
    visiting, visited = set(), set()
    def visit(node_id):
        if node_id in visiting:
            raise ValueError("O flow contém um ciclo. Remova a delegação circular.")
        if node_id in visited:
            return
        visiting.add(node_id)
        for target in outgoing[node_id]:
            visit(target)
        visiting.remove(node_id)
        visited.add(node_id)
    for node_id in known:
        visit(node_id)
    clean_edges = [{"id": str(edge.get("id") or f"{edge['source']}-{edge['target']}")[:100], "source": edge["source"], "target": edge["target"]} for edge in edges]
    return {"rootId": root_id, "nodes": nodes, "edges": clean_edges}


def _tool_for_node(run: FlowRun, node: dict) -> ToolInvocation | None:
    selected = node.get("tools", [])
    if not selected or not run.flow_version.flow.project.resources.exists():
        return None
    existing = run.tool_invocations.filter(flow_node_id=node["id"]).order_by("-created_at").first()
    if existing:
        return existing
    task = run.task.lower()
    cues = ("arquivo", "documento", "csv", "planilha", "dados", "resource", "pandas", "consulta")
    if not any(cue in task for cue in cues):
        return None
    available = {tool.name: tool for tool in ToolDefinition.objects.filter(name__in=selected, enabled=True)}
    tool_name = "pandas_profile_csv" if "pandas_profile_csv" in available and any(cue in task for cue in ("csv", "dados", "planilha", "pandas")) else next(iter(available), None)
    if not tool_name:
        return None
    resource = run.flow_version.flow.project.resources.first()
    arguments = {"resource_id": resource.id}
    if tool_name == "duckdb_query_csv":
        arguments["query"] = "SELECT * FROM source LIMIT 50"
    return ToolInvocation.objects.create(project=run.flow_version.flow.project, conversation=run.conversation, flow_run=run, flow_node_id=node["id"], tool=available[tool_name], arguments=arguments)


def _select_route(run: FlowRun, node: dict, targets: list[str], nodes: dict[str, dict]) -> str:
    choices = ", ".join(f"{target}: {nodes[target]['name']}" for target in targets)
    try:
        answer = complete(node.get("model") or settings.LOCAL_LLM_DEFAULT_MODEL, [
            {"role": "system", "content": f"Você roteia tarefas. Responda somente com um destes IDs: {choices}."},
            {"role": "user", "content": run.task},
        ]).strip()
        if answer in targets:
            return answer
    except Exception:
        pass
    technical_terms = ("código", "python", "api", "bug", "dados", "sql", "arquitetura", "program")
    technical = next((target for target in targets if "tecn" in nodes[target]["name"].lower()), targets[0])
    writer = next((target for target in targets if "texto" in nodes[target]["name"].lower()), targets[-1])
    return technical if any(term in run.task.lower() for term in technical_terms) else writer


def execute_flow(run_id: int) -> None:
    close_old_connections()
    run = FlowRun.objects.select_related("flow_version__flow__project", "conversation").get(id=run_id)
    graph = run.flow_version.graph
    nodes = {node["id"]: node for node in graph["nodes"]}
    edges = graph["edges"]
    trace = list(run.trace)
    completed = {item["nodeId"] for item in trace if item.get("status") == "completed"}
    skipped = {item["nodeId"] for item in trace if item.get("status") == "skipped"}
    if not run.started_at:
        run.started_at = timezone.now()
    run.status, run.error = "running", ""
    run.save(update_fields=["status", "error", "started_at"])
    try:
        while len(completed | skipped) < len(nodes):
            candidate = None
            for node in graph["nodes"]:
                node_id = node["id"]
                if node_id in completed | skipped:
                    continue
                incoming = [edge["source"] for edge in edges if edge["target"] == node_id]
                if all(parent in completed | skipped for parent in incoming):
                    candidate = node
                    break
            if candidate is None:
                raise ValueError("O grafo contém ciclo ou dependências não resolvidas.")
            node, node_id = candidate, candidate["id"]
            run.current_node = node_id
            node_type = node.get("type", "agent")
            run.trace = [*trace, {"nodeId": node_id, "name": node["name"], "type": node_type, "status": "running", "startedAt": timezone.now().isoformat()}]
            run.save(update_fields=["current_node", "trace"])

            targets = [edge["target"] for edge in edges if edge["source"] == node_id]
            if node_type == "router" and len(targets) > 1:
                selected = _select_route(run, node, targets, nodes)
                for target in targets:
                    if target != selected:
                        skipped.add(target)
                        trace.append({"nodeId": target, "name": nodes[target]["name"], "type": nodes[target].get("type", "agent"), "status": "skipped", "reason": f"Rota selecionada: {selected}"})
                output = f"Rota selecionada: {nodes[selected]['name']}"
            else:
                invocation = _tool_for_node(run, node)
                if invocation and invocation.status == "pending":
                    trace.append({"nodeId": node_id, "name": node["name"], "type": node["type"], "status": "awaiting_approval", "invocationId": invocation.id, "tool": invocation.tool.name})
                    run.status, run.trace = "awaiting_approval", trace
                    run.save(update_fields=["status", "trace"])
                    return
                tool_context = ""
                if invocation:
                    tool_context = f"\nResultado da tool {invocation.tool.name} ({invocation.status}): {json.dumps(invocation.result, ensure_ascii=False)}"
                previous = "\n\n".join(f"{item['name']}: {item.get('output', '')}" for item in trace if item.get("status") == "completed")
                memory = memory_context(run.flow_version.flow.project, run.task, node.get("memory", []))
                short = ""
                if "short_term" in node.get("memory", []) and run.conversation:
                    short = "\n".join(f"{message.role}: {message.content}" for message in run.conversation.messages.order_by("-created_at")[:8][::-1])
                system = f"Você é o agente {node['name']} ({node_type}).\n{node.get('systemPrompt') or node.get('prompt', '')}\nUse somente o contexto fornecido e não invente resultados de tools."
                user = f"Tarefa:\n{run.task}\n\nSaídas anteriores:\n{previous or 'Nenhuma'}\n\nMemória relevante:\n{memory or 'Nenhuma'}\n\nConversa recente:\n{short or 'Nenhuma'}{tool_context}"
                output = complete(node.get("model") or settings.LOCAL_LLM_DEFAULT_MODEL, [{"role": "system", "content": system}, {"role": "user", "content": user}])
            trace.append({"nodeId": node_id, "name": node["name"], "type": node_type, "status": "completed", "output": output, "completedAt": timezone.now().isoformat()})
            completed.add(node_id)
            run.trace = trace
            run.save(update_fields=["trace"])

        final = next((item.get("output", "") for item in reversed(trace) if item.get("status") == "completed"), "")
        run.status, run.output, run.current_node, run.completed_at = "completed", final, "", timezone.now()
        run.save(update_fields=["status", "output", "current_node", "completed_at", "trace"])
        if run.conversation:
            Message.objects.create(conversation=run.conversation, role="assistant", content=final, metadata={"flowRunId": run.id, "flowVersion": run.flow_version.version})
        MemoryEntry.objects.create(project=run.flow_version.flow.project, conversation=run.conversation, kind="episodic", content=f"Tarefa: {run.task}\nResultado: {final[:12_000]}", source_type="flow_run", source_id=str(run.id), metadata={"flow": run.flow_version.flow.name, "version": run.flow_version.version})
        AuditEvent.objects.create(project=run.flow_version.flow.project, event_type="flow_run_completed", payload={"run_id": run.id, "flow_id": run.flow_version.flow_id})
    except Exception as error:
        run.status, run.error, run.completed_at = "failed", str(error), timezone.now()
        run.save(update_fields=["status", "error", "completed_at", "trace"])
        AuditEvent.objects.create(project=run.flow_version.flow.project, event_type="flow_run_failed", payload={"run_id": run.id, "error": str(error)})
    finally:
        close_old_connections()


def start_flow_run(run_id: int) -> None:
    threading.Thread(target=execute_flow, args=(run_id,), name=f"flow-run-{run_id}", daemon=True).start()
