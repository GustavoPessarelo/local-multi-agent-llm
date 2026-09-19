"""Cliente para servidores OpenAI-compatible acessíveis somente em loopback."""
from __future__ import annotations

import json
from urllib.parse import urlparse

import httpx
from django.conf import settings


def base_url() -> str:
    value = settings.LOCAL_LLM_BASE_URL.rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("LOCAL_LLM_BASE_URL deve apontar somente para localhost.")
    return value


def list_models() -> dict:
    response = httpx.get(f"{base_url()}/models", timeout=10)
    response.raise_for_status()
    return response.json()


def stream_chat(model: str, messages: list[dict], should_cancel=None):
    payload = {"model": model, "messages": messages, "stream": True, "temperature": 0.2}
    with httpx.stream("POST", f"{base_url()}/chat/completions", json=payload, timeout=120) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if should_cancel and should_cancel():
                return
            if not line or not line.startswith("data: "):
                continue
            raw = line[6:]
            if raw == "[DONE]":
                break
            try:
                payload = json.loads(raw)
                delta = payload["choices"][0].get("delta", {}).get("content", "")
            except (KeyError, IndexError, TypeError, json.JSONDecodeError):
                continue
            if delta:
                yield delta


def complete(model: str, messages: list[dict], response_format: dict | None = None) -> str:
    payload = {"model": model, "messages": messages, "stream": False, "temperature": 0.2}
    if response_format:
        payload["response_format"] = response_format
    response = httpx.post(f"{base_url()}/chat/completions", json=payload, timeout=120)
    response.raise_for_status()
    return response.json()["choices"][0]["message"].get("content", "").strip()


def embed_text(text: str) -> list[float]:
    payload = {"model": settings.LOCAL_EMBEDDING_MODEL, "input": text[:20_000]}
    response = httpx.post(f"{base_url()}/embeddings", json=payload, timeout=20)
    response.raise_for_status()
    return [float(value) for value in response.json()["data"][0]["embedding"]]
