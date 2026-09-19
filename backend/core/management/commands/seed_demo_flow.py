"""Cria flows multiagente demonstráveis na base local de desenvolvimento."""
from __future__ import annotations

from django.core.management.base import BaseCommand

from core.models import Conversation, Flow, FlowVersion, Project
from core.orchestration import validate_graph


DEMO_PROJECT = "Exemplo multiagente"


def reviewed_writing_graph() -> dict:
    return validate_graph({
        "rootId": "planner",
        "nodes": [
            {"id": "planner", "name": "Planejador", "x": 80, "y": 210, "systemPrompt": "Analise a solicitação e transforme-a em um plano curto para o Redator. Você NÃO deve responder ao usuário. Você DEVE delegar ao Redator. Responda na primeira linha `DELEGATE writer`; na segunda linha comece com `TASK:` e escreva o plano junto da solicitação original."},
            {"id": "writer", "name": "Redator", "x": 420, "y": 210, "systemPrompt": "Produza um rascunho útil e correto. Você NÃO deve responder ao usuário. Você DEVE delegar ao Revisor. Responda na primeira linha `DELEGATE reviewer`; na segunda linha comece com `TASK:` e inclua o rascunho completo."},
            {"id": "reviewer", "name": "Revisor", "x": 760, "y": 210, "systemPrompt": "Revise o rascunho, corrija falhas e entregue uma resposta clara em português. Você é a última etapa. Responda na primeira linha com `FINAL` e depois somente a resposta."},
        ],
        "edges": [
            {"id": "planner-writer", "source": "planner", "target": "writer"},
            {"id": "writer-reviewer", "source": "writer", "target": "reviewer"},
        ],
    })


def code_lab_graph() -> dict:
    return validate_graph({
        "rootId": "architect",
        "nodes": [
            {"id": "architect", "name": "Arquiteto", "x": 80, "y": 210, "systemPrompt": "Converta o pedido em requisitos técnicos, entradas, saídas, casos de borda e um plano curto. Não escreva a solução final. Delegue obrigatoriamente ao Desenvolvedor com `DELEGATE developer` na primeira linha e `TASK:` na segunda."},
            {"id": "developer", "name": "Desenvolvedor", "x": 420, "y": 210, "systemPrompt": "Implemente a solução com código completo, legível e pronto para execução. Inclua o plano e o código na tarefa do QA. Delegue obrigatoriamente com `DELEGATE qa` na primeira linha e `TASK:` na segunda."},
            {"id": "qa", "name": "QA", "x": 760, "y": 210, "systemPrompt": "Revise requisitos e código, procure erros, segurança e casos de borda. Corrija o necessário e entregue a versão final com instruções mínimas. Comece com `FINAL` e não mencione o processo interno."},
        ],
        "edges": [
            {"id": "architect-developer", "source": "architect", "target": "developer"},
            {"id": "developer-qa", "source": "developer", "target": "qa"},
        ],
    })


def critical_council_graph() -> dict:
    return validate_graph({
        "rootId": "analyst",
        "nodes": [
            {"id": "analyst", "name": "Analista", "x": 80, "y": 210, "systemPrompt": "Estruture o problema: fatos conhecidos, suposições, opções e critérios de decisão. Não conclua ainda. Envie a análise ao Crítico usando `DELEGATE critic` na primeira linha e `TASK:` na segunda."},
            {"id": "critic", "name": "Crítico", "x": 420, "y": 210, "systemPrompt": "Ataque construtivamente a análise: identifique riscos, lacunas, vieses, trade-offs e condições que mudariam a decisão. Delegue todo o material ao Sintetizador com `DELEGATE synthesizer` na primeira linha e `TASK:` na segunda."},
            {"id": "synthesizer", "name": "Sintetizador", "x": 760, "y": 210, "systemPrompt": "Combine análise e crítica em uma recomendação equilibrada. Diferencie fatos de suposições, apresente riscos e próximos passos. Comece com `FINAL` e entregue apenas a resposta final."},
        ],
        "edges": [
            {"id": "analyst-critic", "source": "analyst", "target": "critic"},
            {"id": "critic-synthesizer", "source": "critic", "target": "synthesizer"},
        ],
    })


DEMOS = [
    {"name": "Demonstração — Planejar, redigir e revisar", "description": "Planejador → Redator → Revisor, para textos e explicações revisadas.", "conversation": "Teste: redação revisada", "graph": reviewed_writing_graph},
    {"name": "Laboratório de código — Arquitetura, implementação e QA", "description": "Arquiteto → Desenvolvedor → QA, para produzir e revisar código.", "conversation": "Teste: laboratório de código", "graph": code_lab_graph},
    {"name": "Conselho crítico — Análise, crítica e síntese", "description": "Analista → Crítico → Sintetizador, para decisões e comparações com trade-offs.", "conversation": "Teste: conselho crítico", "graph": critical_council_graph},
]


class Command(BaseCommand):
    help = "Cria ou atualiza o projeto e os flows de demonstração multiagente local."

    def handle(self, *args, **options):
        project, _ = Project.objects.get_or_create(name=DEMO_PROJECT)
        created_flows: list[Flow] = []
        for demo in DEMOS:
            flow, _ = Flow.objects.get_or_create(
                project=project,
                name=demo["name"],
                defaults={"description": demo["description"], "active_version": 0},
            )
            graph = demo["graph"]()
            active = flow.versions.filter(version=flow.active_version).first()
            if active is None or active.graph != graph:
                version_number = (flow.versions.order_by("-version").values_list("version", flat=True).first() or 0) + 1
                FlowVersion.objects.create(flow=flow, version=version_number, graph=graph)
                flow.active_version = version_number
            flow.description = demo["description"]
            flow.save(update_fields=["active_version", "description", "updated_at"])
            Conversation.objects.get_or_create(project=project, title=demo["conversation"])
            created_flows.append(flow)

        summary = ", ".join(f"#{flow.id} v{flow.active_version}" for flow in created_flows)
        self.stdout.write(self.style.SUCCESS(f"{len(created_flows)} flows de demonstração prontos no projeto #{project.id}: {summary}."))
