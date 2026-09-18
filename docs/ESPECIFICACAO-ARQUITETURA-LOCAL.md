# Especificação — Plataforma local de LLMs e sistemas multiagente

## 1. Objetivo

Criar um único software local para conversar com LLMs/SLMs, usar tools,
construir e executar sistemas multiagente por um canvas low-code e administrar
memórias, projetos e resources. Em execução, inferência e dados permanecem na
máquina do usuário.

O protótipo atual em `app/` é referência de aprendizado; não é a arquitetura
alvo e não deve ser estendido antes da fundação descrita aqui.

## 2. Princípios e restrições

- Um produto visual único: Chat, Fluxos, Modelos, Tools, Memórias e Projetos.
- Um endpoint de inferência por padrão: Bionic/LM Studio local, compatível com
  a API OpenAI, em loopback.
- Sem fallback para OpenAI, Codex ou qualquer provedor externo.
- Modelo único carregado inicialmente; papéis de agentes são configuração,
  não modelos simultâneos.
- Toda entrada, saída, configuração de nó e chamada de tool é validada por
  Pydantic.
- Tools com escrita, execução ou custo exigem política e aprovação humana.
- Fluxos e tools são versionados, auditáveis e reproduzíveis.

## 3. Arquitetura alvo

```text
Angular + TypeScript (uma única interface)
  ├── Chat
  ├── Canvas de fluxos
  ├── Catálogo de modelos, tools, resources e memórias
  └── Monitor de execuções
                 │ HTTP/SSE local
Django — API do produto
  ├── sessão, projetos, autorização e auditoria
  ├── registro/versionamento de grafos
  └── API de execução e streaming
                 │
LangGraph Runtime
  ├── agentes, nós determinísticos, roteamento e interrupções
  ├── checkpoints e retomada
  └── compilador: FlowSpec -> grafo executável
        ├──────────────┬──────────────┐
      Gateway LLM    FastMCP       Memória/resources
        │               │                 │
 Bionic/LM Studio   tools locais    SQLite + arquivos + índice local
```

### Responsabilidades

| Camada | Responsabilidade | Não deve fazer |
|---|---|---|
| Interface | edição/execução visual e observação | falar direto com o modelo ou executar shell |
| API | autenticação local, persistência e streaming | conter prompts de negócio |
| LangGraph | estado, transições, retries, interrupções | escolher hosts externos |
| Gateway LLM | modelos, capacidades e limites | saber regras de um fluxo |
| FastMCP | tools/resources/prompts locais | decidir se uma tool é permitida |
| Política | autorização, preview e auditoria | executar inferência |

## 4. Interface do produto

Uma única URL e shell visual. A navegação é por menu, não por aplicações ou
portas diferentes.

1. **Chat** — conversa com um agente ou fluxo publicado; mostra streaming,
   passos, tools, aprovações e fontes de memória.
2. **Fluxos** — canvas Angular com nós, portas tipadas e arestas dirigidas.
3. **Modelos** — descobre modelos no gateway local, exibe capacidades e define
   o padrão do projeto.
4. **Tools** — catálogo, schema, permissões, testes, versão e histórico.
5. **Memória e Resources** — documentos, coleções, fatos, episódios e regras.
6. **Projetos** — workspace, membros, políticas, fluxos e recursos isolados.
7. **Execuções** — trace navegável por nó, custo local estimado, tokens,
   latência, artefatos e erros.

## 5. Contratos de domínio

Pydantic é a fonte de verdade. O frontend recebe JSON derivado desses modelos.

```text
ModelDescriptor(id, endpoint, context_window, tool_calling, json_schema, embedding)
ToolSpec(name, version, input_schema, output_schema, permissions, approval_mode)
AgentSpec(id, name, system_prompt, model_id, tools, memory_policy, output_schema)
FlowSpec(id, version, project_id, nodes, edges, entry_node, outputs)
NodeSpec(id, kind, config, input_ports, output_ports)
RunSpec(flow_id, version, project_id, thread_id, input, overrides)
RunEvent(run_id, node_id, type, payload, timestamp)
ResourceSpec(id, project_id, kind, uri, metadata, access_policy)
MemoryRecord(id, namespace, type, content, source, confidence, expires_at)
```

Tipos iniciais de nó: `input`, `agent`, `router`, `tool`, `resource_search`,
`memory_read`, `memory_write`, `condition`, `approval`, `loop`, `transform` e
`output`.

O compilador rejeita portas incompatíveis, nós desconectados, ciclos sem limite
e tools não autorizadas. Loops sempre exigem `max_iterations` e condição de
saída.

## 6. Execução de agentes

### Single agent

`ChatInput -> MemoryRead -> Agent -> OptionalToolLoop -> MemoryWrite -> Output`

O agente recebe somente as tools habilitadas no fluxo/projeto e nunca escolhe
um executável arbitrário.

### Multiagente inicial

Padrões entregues como templates:

- Planejador -> Executor -> Revisor.
- Supervisor -> Especialista(s) -> Síntese.
- Router -> Agente especializado.
- Map -> trabalho paralelo lógico -> Reduce.

Com um único modelo carregado, a execução é prioritariamente sequencial. O
runtime pode agrupar chamadas quando o servidor de inferência suportar batching,
mas não promete paralelismo real de GPU.

### Roteamento contextual

A primeira versão deve ser determinística e explicável: tipo de solicitação,
tools exigidas, resource citado, tamanho do contexto, política do projeto e
capacidade do modelo. Um roteador LLM ou classificador especializado é fase
posterior e precisa competir contra essa baseline em avaliações locais.

## 7. Tools, skills e MCP

O FastMCP local hospeda três tipos de capacidade:

- `@tool`: ação com schema de entrada/saída.
- `@resource`: conteúdo endereçável, como documento, dataset ou contexto de
  projeto.
- `@prompt`: template versionado e reutilizável.

Categorias iniciais de tools: leitura/extração de documento, busca em resource,
Pandas/DuckDB em datasets permitidos, geração de artefato e operações de arquivo
restritas ao workspace.

Uma skill é uma instrução/processo reutilizável. Uma tool gerada por modelo não
entra no catálogo diretamente: nasce em quarentena, recebe schema, testes,
análise estática, preview e aprovação humana antes de publicação.

Política mínima para cada execução:

- allow-list por projeto e fluxo;
- diretório de trabalho fixado;
- timeout, tamanho máximo de arquivo e limite de memória;
- preview antes de escrita/execução;
- log imutável de argumento, resultado e artefatos;
- bloqueio explícito de rede para tools que não a necessitam.

## 8. Memória e resources

| Tipo | Escopo | Escrita | Leitura |
|---|---|---|---|
| Curto prazo | thread | mensagens, resumo, estado do grafo | todos os nós da execução |
| Episódica | projeto/thread | decisão, tool, resultado e falha | recuperação por tarefa/data |
| Longo prazo | usuário/projeto | fatos com fonte, confiança e expiração | busca semântica e filtros |
| Projeto | projeto | arquivos, regras e artefatos | tools/resource search |
| Resource | coleção compartilhada | curadoria explícita | nós autorizados |

Começar com SQLite para metadados, checkpoints, auditoria e FTS. O conteúdo de
arquivos fica em diretório de projeto. Embeddings locais e índice vetorial entram
quando busca semântica for necessária; não são pré-requisito do chat nem de
tools determinísticas.

## 9. Gateway de modelos

O gateway expõe internamente `models`, `chat` e, quando disponível,
`embeddings`. Ele aceita apenas URLs loopback por padrão e mantém um registro
de capacidade por modelo, descoberto ou configurado:

- janela de contexto;
- streaming;
- JSON Schema;
- tool calling nativo;
- embeddings;
- quantização e telemetria disponível.

Se o modelo não suportar tool calling nativo, o runtime usa decisão estruturada
validada por schema. Não há simulação silenciosa de uma tool bem-sucedida.

## 10. Segurança e observabilidade

- Execução local não é sinônimo de execução segura.
- O MVP usa sandbox lógico: workspace delimitado, allow-list e aprovação.
- Sandbox de SO/VM/WSL é fase posterior, aplicada a código não confiável.
- Eventos são emitidos por SSE: `run_started`, `node_started`, `model_delta`,
  `tool_preview`, `approval_required`, `tool_result`, `node_completed`,
  `run_failed` e `run_completed`.
- Cada execução é reproduzível por `flow_version`, `model_id`, configurações,
  inputs, tools e hashes de resources.

## 11. Stack inicial

| Área | Escolha |
|---|---|
| Frontend | Angular, TypeScript, biblioteca de canvas compatível com Angular, RxJS e SSE |
| API/runtime | Python 3.11, Django, Django REST Framework, Pydantic, LangGraph, HTTPX |
| Tools | FastMCP, Pandas, DuckDB, extratores locais |
| Persistência | SQLite + migrações; arquivos por projeto |
| Inferência | Bionic/LM Studio local por API compatível OpenAI |
| Testes | pytest, testes de contrato, fixtures de tools, evals locais |

Langflow fica como laboratório opcional de protótipos e referência de UX, não
como dependência do caminho de produção do MVP. Isso evita duas interfaces e
permite que o canvas Angular do produto tenha o mesmo modelo de dados que o
runtime.

## 12. Fases e critérios de aceite

### F0 — Base limpa

- Novo diretório/serviço sem reaproveitar código do protótipo por cópia.
- Um comando inicia interface, API, MCP e runtime.
- Endpoint de modelo configurado exclusivamente como local.

**Aceite:** chat vazio abre, lista os modelos locais e bloqueia URL remota.

### F1 — Single agent útil

- Conversa com streaming, threads, seleção de modelo e persistência.
- Tool de leitura de arquivo com preview e auditoria.
- Checkpoint por thread.

**Aceite:** conversa é retomada após reinício e tool não lê fora do projeto.

### F2 — MCP, resources e políticas

- Catálogo FastMCP, resources de projeto, Pandas/DuckDB e aprovação.
- Publicação de skill/tool em quarentena.

**Aceite:** uma tool não autorizada é bloqueada e uma autorizada deixa trace.

### F3 — Multiagente backend

- Templates sequenciais e roteamento determinístico.
- Contratos entre agentes e visualização de passos.

**Aceite:** execução com planejador/executor/revisor é retomável e auditável.

### F4 — Canvas low-code próprio

- Editor de nós/arestas, validação, versionamento e execução.
- Configuração visual de modelo, prompt, tools e políticas de memória.

**Aceite:** usuário cria, salva, duplica e executa um fluxo sem editar código.

### F5 — Memória semântica e avaliações

- Embeddings locais, recuperação com fonte e controles de retenção.
- Dataset de avaliação para roteamento, tools e qualidade de fluxo.

**Aceite:** memória recuperada mostra fonte e pode ser corrigida/removida.

### F6 — Especialização e GPU

- Perfis de modelo por tarefa, batching, cache e benchmarks.
- Experimentos de finetuning e kernels CUDA isolados do produto.

**Aceite:** qualquer otimização melhora uma métrica medida sem quebrar os
contratos de execução.

## 13. Decisões a tomar antes da F0

1. Nome e diretório do novo produto.
2. Formato de distribuição inicial: desktop local, web local ou ambos.
3. Qual biblioteca de canvas Angular será adotada na F4 (por exemplo, uma
   integração Angular de grafo ou canvas próprio) ou se Langflow será uma
   ferramenta temporária de autoria fora do produto.
4. Política para execução de código: somente aprovação humana no MVP ou já
   exigir sandbox de SO.
5. Primeiro conjunto de tools permitido.
