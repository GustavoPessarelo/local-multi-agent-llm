# InDev — aplicação local

Esta pasta contém a interface, as rotas locais, a ponte WebSocket, o inicializador do harness e os testes do InDev.

Arquivos Excel `.xlsx` são convertidos localmente em contexto textual estruturado antes do envio ao agente; o arquivo original também é preservado.

## Requisitos

- Node.js 22.13 ou superior.
- Internet na primeira instalação e para usar os modelos da OpenAI.
- Login da OpenAI ou uma chave em `.env.local`.

O Codex CLI não precisa estar instalado globalmente: `@openai/codex` faz parte das dependências do projeto.

## Executar

```bash
npm install
npm run setup
npm run dev
```

O InDev estará em `http://localhost:3001`. Nada é publicado.

## Verificar

```bash
npm run doctor
npm run lint
npm test
npm run test:e2e
```

O teste de ponta a ponta usa o Codex do `node_modules`, abre portas isoladas, grava e lê um arquivo pelo App Server e confirma uma resposta real da LLM em streaming.

## Tools locais

O InDev descobre automaticamente módulos em `tools/builtin/` e envia seus schemas para todo chat novo. A primeira integração é `analise_massiva_llm`: ela lê um `.xlsx`, mostra uma prévia com quantidade de chamadas e os dados enviados, exige autorização de custo e cria outro Excel na pasta de entregas daquele chat. Essa tool usa `OPENAI_API_KEY` diretamente e adota `OPENAI_MASSIVA_MODEL=gpt-5.6-luna` como padrão.

Para criar uma integração nova, siga [Como adicionar uma nova tool](tools/CRIAR_NOVA_TOOL.md). O registro já cuida de descoberta, validação do schema e aprovação de uso único; cada módulo precisa implementar somente o comportamento específico.

O renderizador `renderizar_documento` transforma Markdown em HTML seguro e standalone. A identidade visual fica separada em `document-profiles/`; o perfil inicial `itau` inclui layout institucional e logo no canto superior esquerdo. Para adicionar outra identidade sem duplicar a tool, siga [Como adicionar um perfil](document-profiles/CRIAR_NOVO_PERFIL.md).

## Dados privados

O login, o histórico operacional e os uploads ficam em `../.indev/`, que é ignorada pelo Git. O arquivo `.env.local` também é ignorado. Use `.env.example` apenas como modelo.

Mais detalhes estão no [README principal](../README.md).
