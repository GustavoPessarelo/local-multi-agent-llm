# Local Agent Studio v2

Aplicação Angular + Django para conversar e executar sistemas multiagentes com
modelos locais OpenAI-compatible. O gateway rejeita hosts externos e usa, por
padrão, `http://127.0.0.1:1234/v1`.

## Funcionalidades

- conversas independentes por projeto, títulos automáticos e renomeação;
- chat com streaming e tools determinísticas sujeitas a aprovação;
- templates Planejador → Executor → Revisor e Roteador Contextual;
- canvas visual com nós arrastáveis, arestas dirigidas, prompts, modelos, tools
  e memória configuráveis por agente;
- versões imutáveis de cada flow e monitor de execução por nó;
- memória curta, episódica, longa e de projeto;
- busca local sobre memórias e resources, com embedding local e fallback
  lexical quando o modelo de embedding não estiver carregado.

## Executar

Com o servidor de modelos aberto na porta `1234`:

```powershell
cd v2
.\scripts\dev.ps1
```

Abra apenas `http://127.0.0.1:4200`. O script aplica migrações e reaproveita os
servidores caso as portas `8000` e `4200` já estejam saudáveis.

## Primeira instalação

```powershell
cd v2
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
cd frontend
npm install
```

## Ambiente local

Copie `.env.example` para `.env` somente quando quiser mudar modelos ou
configurações. O Django carrega esse arquivo automaticamente. As configurações
principais são:

- `LOCAL_LLM_BASE_URL`: endpoint OpenAI-compatible em localhost;
- `LOCAL_LLM_DEFAULT_MODEL`: modelo padrão dos agentes;
- `LOCAL_EMBEDDING_MODEL`: modelo local usado pela busca semântica.

## Validação

```powershell
.\.venv\Scripts\python.exe backend\manage.py test core
cd frontend
npm run build
```
