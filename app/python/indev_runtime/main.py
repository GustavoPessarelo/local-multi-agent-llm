from __future__ import annotations

import os
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

LOCAL_BASE_URL = os.getenv("INDEV_LOCAL_BASE_URL", "http://127.0.0.1:1234/v1").rstrip("/")
DEFAULT_MODEL = os.getenv("INDEV_DEFAULT_MODEL", "google/gemma-3-4b")

app = FastAPI(title="InDev Agent Runtime", version="0.1.0")


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)


class AgentSpec(BaseModel):
    name: str
    system_prompt: str


class RunRequest(BaseModel):
    prompt: str = Field(min_length=1)
    model: str = DEFAULT_MODEL
    agents: list[AgentSpec] | None = None


class AgentResult(BaseModel):
    agent: str
    content: str


class RunResponse(BaseModel):
    model: str
    final: str
    steps: list[AgentResult]


DEFAULT_AGENTS = [
    AgentSpec(name="planejador", system_prompt="Você é o planejador. Analise o pedido e produza um plano concreto, curto e verificável."),
    AgentSpec(name="executor", system_prompt="Você é o executor. Com base no plano e no pedido, proponha a implementação ou a próxima ação precisa. Não alegue executar algo."),
    AgentSpec(name="revisor", system_prompt="Você é o revisor. Verifique riscos, lacunas e critérios de aceite. Entregue uma recomendação final objetiva."),
]


async def complete(model: str, messages: list[ChatMessage]) -> str:
    payload = {"model": model, "temperature": 0.2, "stream": False, "messages": [item.model_dump() for item in messages]}
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(f"{LOCAL_BASE_URL}/chat/completions", json=payload)
            response.raise_for_status()
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail=f"Modelo local indisponível: {error}") from error
    content = response.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    if not content:
        raise HTTPException(status_code=502, detail="O modelo local não retornou texto.")
    return content


@app.get("/health")
async def health():
    return {"ok": True, "provider": "local-openai-compatible", "base_url": LOCAL_BASE_URL}


@app.get("/models")
async def models():
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{LOCAL_BASE_URL}/models")
            response.raise_for_status()
        return response.json()
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.post("/runs", response_model=RunResponse)
async def run(request: RunRequest):
    transcript = request.prompt
    results: list[AgentResult] = []
    for agent in request.agents or DEFAULT_AGENTS:
        content = await complete(request.model, [
            ChatMessage(role="system", content=agent.system_prompt),
            ChatMessage(role="user", content=f"Pedido original:\n{request.prompt}\n\nContexto produzido até agora:\n{transcript}"),
        ])
        results.append(AgentResult(agent=agent.name, content=content))
        transcript = f"{transcript}\n\n[{agent.name}]\n{content}"
    return RunResponse(model=request.model, final=results[-1].content, steps=results)
