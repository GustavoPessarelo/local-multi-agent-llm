import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.conf import settings
from django.test import TestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile

from .local_llm import base_url
from .models import Flow, FlowRun, FlowVersion, MemoryEntry, Project, Resource, ToolDefinition, ToolInvocation
from .orchestration import FLOW_TEMPLATES, execute_flow
from .tools import ensure_builtin_tools, execute


class GatewaySecurityTests(TestCase):
    @override_settings(LOCAL_LLM_BASE_URL="https://api.example.com/v1")
    def test_remote_model_endpoint_is_rejected(self):
        with self.assertRaises(ValueError):
            base_url()


class ToolExecutionTests(TestCase):
    def setUp(self):
        ensure_builtin_tools()
        self.project = Project.objects.create(name="Teste")

    def test_duckdb_rejects_non_select_query(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            project_root = root / "projects" / str(self.project.id) / "resources"
            project_root.mkdir(parents=True)
            csv_path = project_root / "data.csv"
            csv_path.write_text("name,value\na,1\n", encoding="utf-8")
            resource = Resource.objects.create(project=self.project, name="data.csv", relative_path="resources/data.csv", mime_type="text/csv", size_bytes=csv_path.stat().st_size)
            invocation = ToolInvocation.objects.create(project=self.project, tool=ToolDefinition.objects.get(name="duckdb_query_csv"), arguments={"resource_id": resource.id, "query": "DROP TABLE source"}, status="approved")
            with override_settings(DATA_ROOT=root):
                with self.assertRaises(ValueError):
                    execute(invocation)


class ApiWorkflowTests(TestCase):
    def test_conversation_and_project_can_be_deleted(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            project = Project.objects.create(name="Descartável")
            project_root = root / "projects" / str(project.id)
            project_root.mkdir(parents=True)
            conversation = project.conversations.create(title="Temporária")
            deleted_conversation = self.client.delete(f"/api/conversations/{conversation.id}")
            self.assertEqual(deleted_conversation.status_code, 200)
            self.assertFalse(project.conversations.filter(id=conversation.id).exists())
            with override_settings(DATA_ROOT=root):
                deleted_project = self.client.delete(f"/api/projects/{project.id}")
            self.assertEqual(deleted_project.status_code, 200)
            self.assertFalse(Project.objects.filter(id=project.id).exists())
            self.assertFalse(project_root.exists())

    def test_multiagent_run_executes_graph_and_creates_episode(self):
        project = Project.objects.create(name="Projeto")
        flow = Flow.objects.create(project=project, name="Pipeline", active_version=1)
        version = FlowVersion.objects.create(flow=flow, version=1, graph=FLOW_TEMPLATES[0]["graph"])
        run = FlowRun.objects.create(flow_version=version, task="Crie uma função soma")
        with patch("core.orchestration.complete", side_effect=["Plano", "Implementação", "Resposta revisada"]):
            execute_flow(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "completed")
        self.assertEqual(run.output, "Resposta revisada")
        self.assertEqual(len([item for item in run.trace if item["status"] == "completed"]), 3)
        self.assertTrue(project.memories.filter(kind="episodic", source_id=str(run.id)).exists())

    def test_conversation_can_be_renamed(self):
        project = Project.objects.create(name="Projeto")
        created = self.client.post(f"/api/projects/{project.id}/conversations", data='{}', content_type="application/json")
        conversation_id = created.json()["conversation"]["id"]
        second = self.client.post(f"/api/projects/{project.id}/conversations", data='{}', content_type="application/json")
        self.assertNotEqual(conversation_id, second.json()["conversation"]["id"])
        renamed = self.client.patch(f"/api/conversations/{conversation_id}", data='{"title":"Plano de dados"}', content_type="application/json")
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.json()["conversation"]["title"], "Plano de dados")
        listed = self.client.get(f"/api/projects/{project.id}/conversations")
        self.assertEqual(len(listed.json()["conversations"]), 2)

    def test_flow_template_versioning_and_memory_search(self):
        project = Project.objects.create(name="Projeto")
        created = self.client.post(
            f"/api/projects/{project.id}/flows",
            data='{"templateKey":"planner-executor-reviewer"}',
            content_type="application/json",
        )
        self.assertEqual(created.status_code, 201)
        flow = created.json()["flow"]
        self.assertEqual(flow["activeVersion"], 1)
        saved = self.client.post(
            f'/api/flows/{flow["id"]}/versions',
            data=json.dumps({"graph": flow["graph"]}),
            content_type="application/json",
        )
        self.assertEqual(saved.status_code, 201)
        self.assertEqual(saved.json()["version"]["version"], 2)
        MemoryEntry.objects.create(project=project, kind="project", content="O backend oficial usa Django e SQLite.")
        with patch("core.memory.embed_text", side_effect=RuntimeError("embedding offline")):
            search = self.client.post(
                f"/api/projects/{project.id}/search",
                data='{"query":"Django backend"}',
                content_type="application/json",
            )
        self.assertEqual(search.status_code, 200)
        self.assertEqual(search.json()["results"][0]["type"], "memory")

    def test_project_resource_and_approved_profile_tool(self):
        created = self.client.post("/api/projects", data='{"name":"Projeto de teste"}', content_type="application/json")
        self.assertEqual(created.status_code, 201)
        project_id = created.json()["project"]["id"]
        uploaded = self.client.post(
            f"/api/projects/{project_id}/resources",
            {"file": SimpleUploadedFile("dados.csv", b"name,value\na,1\nb,2\n", content_type="text/csv")},
        )
        self.assertEqual(uploaded.status_code, 201)
        resource_id = uploaded.json()["resource"]["id"]
        requested = self.client.post(
            f"/api/projects/{project_id}/tools/invocations",
            data=f'{{"tool":"pandas_profile_csv","arguments":{{"resource_id":{resource_id}}}}}',
            content_type="application/json",
        )
        self.assertEqual(requested.status_code, 201)
        invocation_id = requested.json()["invocation"]["id"]
        completed = self.client.post(f"/api/tool-invocations/{invocation_id}/approve")
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.json()["invocation"]["status"], "completed")
