"""Ferramentas determinísticas, confinadas aos resources do projeto."""
from __future__ import annotations

from pathlib import Path
import re

import duckdb
import pandas as pd
from django.conf import settings
from django.utils import timezone

from .contracts import ToolArguments
from .models import AuditEvent, Resource, ToolDefinition, ToolInvocation

BUILTIN_TOOLS = [
    ("read_resource", "Ler resource", "Lê texto de um arquivo enviado ao projeto.", {"resource_id": "integer"}),
    ("pandas_profile_csv", "Perfil Pandas", "Gera perfil seguro de um CSV resource.", {"resource_id": "integer"}),
    ("duckdb_query_csv", "Consulta DuckDB", "Executa uma consulta SELECT em um CSV resource.", {"resource_id": "integer", "query": "string"}),
]


def ensure_builtin_tools() -> None:
    for name, display_name, description, input_schema in BUILTIN_TOOLS:
        ToolDefinition.objects.get_or_create(
            name=name,
            defaults={"display_name": display_name, "description": description, "input_schema": input_schema, "requires_approval": True},
        )


def resource_path(resource: Resource) -> Path:
    root = (settings.DATA_ROOT / "projects" / str(resource.project_id)).resolve()
    path = (root / resource.relative_path).resolve()
    if root not in path.parents or not path.is_file():
        raise ValueError("Resource não está disponível no workspace do projeto.")
    return path


def execute(invocation: ToolInvocation) -> dict:
    args = ToolArguments.model_validate(invocation.arguments)
    resource = Resource.objects.get(id=args.resource_id, project=invocation.project)
    path = resource_path(resource)

    if invocation.tool.name == "read_resource":
        result = {"resource": resource.name, "content": path.read_text(encoding="utf-8", errors="replace")[:30_000]}
    elif invocation.tool.name == "pandas_profile_csv":
        frame = pd.read_csv(path, nrows=50_000)
        result = {
            "resource": resource.name,
            "rows_sampled": len(frame),
            "columns": [{"name": str(column), "dtype": str(frame[column].dtype), "nulls": int(frame[column].isna().sum())} for column in frame.columns],
            "sample": frame.head(8).fillna("").to_dict(orient="records"),
        }
    elif invocation.tool.name == "duckdb_query_csv":
        query = (args.query or "").strip()
        if not re.match(r"^(select|with)\b", query, flags=re.IGNORECASE) or ";" in query:
            raise ValueError("A consulta DuckDB deve ser somente SELECT ou WITH, sem ponto e vírgula.")
        with duckdb.connect(":memory:") as connection:
            connection.execute("CREATE VIEW source AS SELECT * FROM read_csv_auto(?)", [str(path)])
            rows = connection.execute(f"SELECT * FROM ({query}) AS safe_query LIMIT 200").fetchdf()
        result = {"resource": resource.name, "rows": rows.fillna("").to_dict(orient="records"), "count": len(rows)}
    else:
        raise ValueError("Tool não reconhecida.")

    invocation.status = "completed"
    invocation.result = result
    invocation.completed_at = timezone.now()
    invocation.save(update_fields=["status", "result", "completed_at"])
    AuditEvent.objects.create(project=invocation.project, event_type="tool_completed", payload={"invocation_id": invocation.id, "tool": invocation.tool.name})
    return result
