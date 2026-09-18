"""Ponte visual entre o Langflow e o runtime multiagente local do InDev."""

from __future__ import annotations

import json
from typing import Any

import httpx
from lfx.custom.custom_component.component import Component
from lfx.io import MultilineInput, Output, StrInput


class InDevMultiAgentComponent(Component):
    display_name = "InDev Multiagente Local"
    description = "Executa uma sequência local de agentes pelo runtime InDev, sem API externa."
    icon = "Bot"
    name = "InDevMultiAgent"

    inputs = [
        MultilineInput(name="prompt", display_name="Prompt", info="Pedido enviado ao sistema multiagente local.", value="Analise este pedido e proponha uma resposta verificável."),
        StrInput(name="model", display_name="Modelo local", info="ID exposto pelo LM Studio/Bionic em http://127.0.0.1:1234/v1/models.", value="google/gemma-3-4b"),
        MultilineInput(name="agents_json", display_name="Agentes (JSON)", info="Opcional. Lista com name e system_prompt. Vazio usa planejador, executor e revisor.", value="", advanced=True),
    ]

    outputs = [
        Output(display_name="Resposta final", name="final", method="build_final"),
        Output(display_name="Rastreio dos agentes", name="trace", method="build_trace"),
    ]

    def _run(self) -> dict[str, Any]:
        if hasattr(self, "_indev_result"):
            return self._indev_result

        payload: dict[str, Any] = {"prompt": self.prompt, "model": self.model}
        if self.agents_json.strip():
            try:
                agents = json.loads(self.agents_json)
            except json.JSONDecodeError as error:
                raise ValueError("Agentes (JSON) precisa conter JSON válido.") from error
            if not isinstance(agents, list) or not all(isinstance(agent, dict) and {"name", "system_prompt"} <= agent.keys() for agent in agents):
                raise ValueError("Cada agente precisa ter os campos name e system_prompt.")
            payload["agents"] = agents

        try:
            response = httpx.post("http://127.0.0.1:8010/runs", json=payload, timeout=180)
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise RuntimeError(f"Runtime local InDev indisponível: {error}") from error

        self._indev_result = response.json()
        return self._indev_result

    def build_final(self) -> str:
        return self._run()["final"]

    def build_trace(self) -> str:
        return json.dumps(self._run()["steps"], ensure_ascii=False, indent=2)
