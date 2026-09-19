"""Memórias locais com embeddings opcionais e fallback lexical determinístico."""
from __future__ import annotations

import math
import re

from .local_llm import embed_text
from .models import MemoryEntry, Project


def safe_embedding(text: str) -> list[float]:
    try:
        return embed_text(text)
    except Exception:
        return []


def lexical_score(query: str, text: str) -> float:
    query_terms = set(re.findall(r"\w+", query.lower()))
    text_terms = set(re.findall(r"\w+", text.lower()))
    return len(query_terms & text_terms) / max(1, len(query_terms | text_terms))


def cosine(first: list[float], second: list[float]) -> float:
    if not first or len(first) != len(second):
        return 0.0
    denominator = math.sqrt(sum(value * value for value in first)) * math.sqrt(sum(value * value for value in second))
    return sum(a * b for a, b in zip(first, second)) / denominator if denominator else 0.0


def create_memory(project: Project, kind: str, content: str, **kwargs) -> MemoryEntry:
    if kind not in {"episodic", "long_term", "project"}:
        raise ValueError("Tipo de memória inválido.")
    content = content.strip()
    if not content or len(content) > 40_000:
        raise ValueError("A memória deve ter entre 1 e 40.000 caracteres.")
    return MemoryEntry.objects.create(project=project, kind=kind, content=content, embedding=safe_embedding(content), **kwargs)


def search_project(project: Project, query: str, limit: int = 8) -> list[dict]:
    query = query.strip()
    if not query:
        return []
    query_embedding = safe_embedding(query)
    results: list[dict] = []
    for memory in project.memories.all()[:200]:
        semantic = cosine(query_embedding, memory.embedding)
        lexical = lexical_score(query, memory.content)
        results.append({
            "type": "memory", "id": memory.id, "kind": memory.kind,
            "label": memory.kind.replace("_", " "), "content": memory.content,
            "score": max(semantic, lexical), "metadata": memory.metadata,
        })
    for resource in project.resources.exclude(text_preview="")[:100]:
        lexical = lexical_score(query, f"{resource.name} {resource.text_preview}")
        results.append({
            "type": "resource", "id": resource.id, "kind": "resource",
            "label": resource.name, "content": resource.text_preview,
            "score": lexical, "metadata": {"mimeType": resource.mime_type},
        })
    return sorted(results, key=lambda item: item["score"], reverse=True)[: max(1, min(limit, 20))]


def memory_context(project: Project, query: str, kinds: list[str]) -> str:
    allowed = {kind for kind in kinds if kind in {"episodic", "long_term", "project"}}
    if not allowed:
        return ""
    matches = [item for item in search_project(project, query, 8) if item["type"] == "memory" and item["kind"] in allowed]
    return "\n".join(f"- [{item['kind']}] {item['content']}" for item in matches)


def serialize_memory(memory: MemoryEntry) -> dict:
    return {
        "id": memory.id, "kind": memory.kind, "content": memory.content,
        "sourceType": memory.source_type, "sourceId": memory.source_id,
        "metadata": memory.metadata, "createdAt": memory.created_at.isoformat(),
    }
