from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from django.conf import settings
from django.utils import timezone


def _gpu_snapshot() -> list[dict]:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3, check=True,
        )
        rows = []
        for line in result.stdout.splitlines():
            values = [value.strip() for value in line.split(",")]
            if len(values) == 4:
                rows.append({"name": values[0], "memoryUsedMiB": values[1], "memoryTotalMiB": values[2], "utilizationPercent": values[3]})
        return rows
    except (OSError, subprocess.SubprocessError):
        return []


def write_profile(run) -> str:
    if not run.profiling_enabled:
        return ""
    started = run.started_at or run.created_at
    completed = run.completed_at or timezone.now()
    conversation = run.conversation
    flow = run.flow_version.flow if run.flow_version_id else None
    safe_title = re.sub(r"[^A-Za-z0-9_-]+", "-", conversation.title).strip("-")[:80] or f"conversa-{conversation.id}"
    filename = f"{safe_title}_{started.astimezone().strftime('%Y%m%d_%H%M%S')}.json"
    root = Path(settings.PROFILING_ROOT)
    root.mkdir(parents=True, exist_ok=True)
    events = list(run.events or [])
    payload = {
        "runId": run.id,
        "conversation": {"id": conversation.id, "title": conversation.title},
        "project": {"id": conversation.project_id, "name": conversation.project.name},
        "flow": {"id": flow.id, "name": flow.name, "version": run.flow_version.version} if flow else None,
        "model": run.model,
        "status": run.status,
        "startedAt": started.isoformat(),
        "firstTokenAt": run.first_token_at.isoformat() if run.first_token_at else None,
        "completedAt": completed.isoformat(),
        "durationMs": round((completed - started).total_seconds() * 1000),
        "timeToFirstTokenMs": round((run.first_token_at - started).total_seconds() * 1000) if run.first_token_at else None,
        "inputCharacterCount": len(run.user_message.content) if run.user_message_id else 0,
        "outputCharacterCount": len(run.output),
        "estimatedInputTokens": round(len(run.user_message.content) / 4) if run.user_message_id else 0,
        "estimatedOutputTokens": round(len(run.output) / 4),
        "agents": [event for event in events if event.get("type") in {"agent_started", "agent_completed", "delegated"}],
        "tools": [event for event in events if event.get("type", "").startswith("tool_")],
        "events": events,
        "gpu": _gpu_snapshot(),
        "error": run.error,
    }
    path = root / filename
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path.relative_to(settings.DATA_ROOT)).replace("\\", "/")
