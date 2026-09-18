# Langflow local

## Fluxo multiagente local InDev

O Langflow carrega a extensão local **InDev Local**. Arraste o componente
**InDev Multiagente Local** para o canvas, informe o prompt e escolha o ID do
modelo local. Execute o nó para chamar `http://127.0.0.1:8010/runs`.
Nenhuma chamada de inferência sai da máquina.
O runtime aceita somente o endpoint local `http://127.0.0.1:1234/v1`; não há
chave, fallback ou configuração de OpenAI/Codex nessa execução.

Para iniciar o Langflow com a extensão:

```powershell
.\scripts\start-langflow.ps1
```

O campo avançado `Agentes (JSON)` aceita, por exemplo:

```json
[
  {"name":"pesquisador","system_prompt":"Liste fatos e incertezas."},
  {"name":"arquiteto","system_prompt":"Proponha a arquitetura técnica."},
  {"name":"revisor","system_prompt":"Revise riscos e critérios de aceite."}
]
```

Instale os componentes Python com:

```powershell
.\scripts\install-langflow.ps1
```

Em um terminal, inicie o runtime multiagente:

```powershell
.\scripts\start-agent-runtime.ps1
```

Em outro terminal com a mesma venv ativa, inicie o Langflow:

```powershell
langflow run --host 127.0.0.1 --port 7860
```

No Langflow, crie um fluxo com um componente **HTTP Request** para `POST http://127.0.0.1:8010/runs`. Envie:

```json
{"prompt":"{{input}}","model":"google/gemma-3-4b"}
```

O endpoint retorna as etapas `planejador`, `executor` e `revisor`, além da resposta final. Os papéis podem ser substituídos pelo campo `agents` e são validados com Pydantic.
