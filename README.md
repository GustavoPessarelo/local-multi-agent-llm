# InDev

Espaço para transformar a ideia do InDev em um produto claro, útil e construível.

## Execução atual — modelos locais

Esta cópia inicia somente a interface local e usa um servidor de modelos compatível com a API OpenAI em `localhost`. O ambiente validado usa `http://localhost:1234/v1` e o modelo `google/gemma-3-4b`.

Pré-requisitos:

- Node.js 22.13 ou superior, com npm.
- Um servidor local de modelos ativo e com ao menos um modelo carregado.

Dentro de `app`:

```bash
npm ci
npm run doctor
npm run dev
```

Abra `http://localhost:3001`. O InDev consulta o catálogo local em `/v1/models` e conversa por `/v1/chat/completions`, com streaming. Não requer chave da OpenAI nem inicia o Codex App Server.

Copie `app/.env.example` para `app/.env.local` apenas se a porta, URL ou modelo padrão forem diferentes.

## Histórico — implementação anterior OpenAI/Codex

Esta é a branch principal do InDev. Ela executa o Codex App Server incluído no próprio repositório e usa a OpenAI como provedora de LLM. Não é necessário instalar o Codex Desktop nem um comando `codex` global.

### 1. Pré-requisitos

- Git.
- Node.js 22.13 ou superior, acompanhado do npm.
- Internet para instalar as dependências e acessar os modelos.
- Uma conta compatível com o login do Codex ou uma chave `OPENAI_API_KEY`.

Esta branch não usa Python, `pip` ou Artifactory. Para o provedor Iara, use a branch [`indev-iara`](https://github.com/vitorribas0/indev/tree/indev-iara), cujo README contém as instruções corporativas.

### 2. Clonar a branch correta

```bash
git clone --branch main https://github.com/vitorribas0/indev.git
cd indev
```

Se o repositório já existe:

```bash
git fetch origin
git switch main
git pull --ff-only
```

### 3. Instalar as dependências

No Windows PowerShell, macOS ou Linux:

```bash
cd app
npm ci
```

O `npm ci` lê o `package-lock.json` e instala as versões exatas, inclusive o pacote `@openai/codex` apropriado para Windows, macOS ou Linux.

### 4. Escolher a autenticação

#### Opção A — login seguro do Codex

Dentro de `app`:

```bash
npm run setup
```

Se ainda não houver uma sessão, o comando abre o fluxo de login. Os dados privados ficam em `.indev/codex-home` dentro do clone e não são enviados ao Git.

#### Opção B — chave da API

No Windows PowerShell, a partir da raiz do repositório:

```powershell
Copy-Item app\.env.example app\.env.local
```

No macOS ou Linux:

```bash
cp app/.env.example app/.env.local
```

Preencha `app/.env.local`:

```env
OPENAI_API_KEY=SUA_CHAVE
OPENAI_MODEL=gpt-5.6-luna
OPENAI_MASSIVA_MODEL=gpt-5.6-luna
```

Nunca envie o `.env.local` ao Git. Ele já está ignorado pelo projeto.

A conversa principal aceita o login do Codex ou a chave. A tool `analise_massiva_llm`, que realiza uma chamada por linha da planilha, exige `OPENAI_API_KEY` porque usa a API diretamente e mostra uma confirmação de custo antes de executar.

### 5. Rodar o sistema no terminal

Dentro de `app`:

```bash
npm run dev
```

Abra `http://localhost:3001`. O sistema permanece local; esse comando não publica nenhum site.

O processo inicia automaticamente:

1. Codex App Server local.
2. Ponte segura entre o navegador e o App Server.
3. Interface InDev.

### 6. Inicializadores por sistema operacional

Depois do clone, também é possível iniciar pela raiz do projeto:

- Windows CMD: dê dois cliques em `start-indev.cmd` ou execute `start-indev.cmd`.
- Windows PowerShell: `.\start-indev.ps1`.
- macOS ou Linux: `./start-indev.sh`.

Os inicializadores instalam as dependências, validam a autenticação e iniciam o InDev. Eles não publicam a aplicação.

### 7. Confirmar que está tudo funcionando

Dentro de `app`:

```bash
npm run doctor
npm run lint
npm test
```

Para o teste de ponta a ponta com uma resposta real do modelo:

```bash
npm run test:e2e
```

O último comando usa a conta ou chave configurada e pode consumir tokens.

### 8. Solução rápida de problemas

- **Node incompatível:** confirme `node --version`; é necessário 22.13 ou superior.
- **Login ausente:** execute `npm run setup` novamente.
- **API key ausente na análise massiva:** preencha `OPENAI_API_KEY` em `app/.env.local`.
- **Porta ocupada:** encerre outra execução do InDev; as portas padrão são 3001, 4501 e 4502.
- **Dependência corrompida:** dentro de `app`, execute novamente `npm ci`.
- **Windows bloqueou o script PowerShell:** use `start-indev.cmd` ou execute os comandos `npm ci`, `npm run setup` e `npm run dev` diretamente no terminal.

Histórico operacional e uploads ficam em `.indev/`; credenciais ficam em `app/.env.local` ou no armazenamento privado do Codex. Ambos são ignorados pelo Git.

## Em uma frase

> O InDev será um ambiente de desenvolvimento com IA capaz de entender um projeto, planejar mudanças, escrever código, testar e revisar entregas — com uma experiência tão boa quanto ou melhor que a do Codex.

## Visão inicial

O objetivo não é tentar reproduzir, do zero, um modelo de IA de fronteira. O objetivo é criar um **produto de desenvolvimento assistido por IA**: uma experiência integrada que pode usar modelos disponíveis no mercado e se diferenciar pela qualidade do fluxo de trabalho, contexto do projeto, controle e confiança.

## Princípios do produto

- Entender o projeto antes de alterar qualquer arquivo.
- Mostrar um plano claro e permitir aprovação antes das mudanças relevantes.
- Executar testes e explicar o que mudou.
- Manter cada tarefa rastreável: intenção, alterações, comandos e resultado.
- Deixar a pessoa no controle de permissões, custos e dados.

## O que significa “igual ou melhor”

| Área | Meta para o InDev |
| --- | --- |
| Entendimento | Ler estrutura, documentação, dependências e histórico relevante do projeto. |
| Execução | Criar e editar arquivos, rodar comandos, testes e verificações. |
| Colaboração | Explicar decisões, pedir autorização quando necessário e manter histórico das tarefas. |
| Qualidade | Propor plano, revisar o próprio trabalho e validar antes de entregar. |
| Experiência | Ser simples para começar, mas dar visibilidade e controle a quem desenvolve. |

## Direção de interface

O InDev terá uma experiência de conversa orientada a tarefas, com uma área de contexto expansível para acompanhar o trabalho em tempo real. A referência é a clareza de ferramentas como o Codex, mas com marca, componentes e identidade visual próprios.

```
┌───────────────────────────────┬──────────────────────────────────┐
│ InDev                         │ Tarefa atual                     │
│                               │ ──────────────────────────────── │
│ Conversa                      │ Arquivos alterados               │
│                               │ • src/...                        │
│ Você: implemente X            │                                  │
│                               │ Execução                         │
│ InDev: plano + progresso      │ ✓ testes                         │
│                               │ • comando em andamento           │
│ [ Escreva uma mensagem... ]   │                                  │
│                               │ Resultado / revisão              │
└───────────────────────────────┴──────────────────────────────────┘
```

### Painel lateral de tarefa

- Pode ser aberto, fechado ou redimensionado.
- Mostra plano, progresso e arquivos envolvidos.
- Exibe comandos e testes: aguardando, em execução, concluído ou com falha.
- Reúne diffs, resultados e pontos que precisam de aprovação.
- Permite voltar a tarefas anteriores sem perder o histórico.

O primeiro preview visual está em [design/indev-preview.html](design/indev-preview.html).

## Implementação atual

A aplicação local está em `app/` e já usa o **Codex App Server público** como motor principal. A interface laranja/glass recebe respostas em streaming e mostra o trabalho do agente em tempo real.

O motor não depende mais do Codex Desktop ou de um comando `codex` instalado na máquina. O pacote oficial `@openai/codex` está fixado no `package.json` e no lockfile; na instalação, o npm baixa automaticamente o binário correto para Windows, macOS ou Linux.

Já estão conectados:

- Conta e catálogo de modelos do Codex local.
- Tarefas persistentes e retomada de histórico.
- Tools, comandos, terminal, plano, diffs e alterações de arquivos.
- Sandbox de leitura ou escrita limitada ao projeto.
- Pedidos de aprovação para ações protegidas.
- Upload local de arquivos e seleção de contexto com `@`.
- Leitura automática de Excel `.xlsx`, incluindo múltiplas abas e milhares de linhas.
- Catálogo de skills e envio de skills para a tarefa.
- Comandos `/new`, `/interrupt`, `/compact`, `/skills` e `/status`.
- Responses API como modo de reserva caso o App Server não esteja disponível.
- Registro extensível de tools locais, com validação automática de parâmetros e aprovação de uso único para operações com custo ou risco.
- Tool `analise_massiva_llm` para classificar linhas de Excel com GPT-5.6 Luna e salvar o resultado separado por chat.
- Renderer genérico de documentos em Markdown com perfis visuais versionados; o primeiro perfil implementa documentação Itaú em HTML standalone.

### Começar no Windows

Requisito: [Node.js](https://nodejs.org/) 22.13 ou superior. Windows 11 é recomendado.

Depois de clonar o repositório, dê dois cliques em:

```text
start-indev.cmd
```

Também é possível usar o PowerShell:

```powershell
.\start-indev.ps1
```

O inicializador instala as dependências do próprio projeto, conduz o login da OpenAI e abre todos os componentes locais. Ele não publica o site.

### Começar no macOS ou Linux

```bash
./start-indev.sh
```

### Execução manual

```bash
cd app
npm install
npm run setup
npm run dev
```

Abra `http://localhost:3001`. O comando inicia automaticamente o site, o Codex App Server incluído no projeto e uma ponte WebSocket que só aceita a origem local do InDev.

### O que está no repositório

- Frontend, backend de reserva, ponte segura, harness, testes e inicializadores multiplataforma.
- Versão exata do Codex e de todas as dependências registrada em `package-lock.json`.
- Configuração de exemplo em `app/.env.example`.
- Diagnóstico local com `npm run doctor`.

O `node_modules` não é enviado ao Git: ele é reproduzido pelo `npm install` usando o lockfile. Modelos de IA continuam sendo serviços da OpenAI e exigem internet e uma conta ou chave válida.

Login, chave, histórico e uploads ficam em `.indev/` dentro do clone, mas essa pasta é ignorada pelo Git para não vazar dados privados. Como alternativa ao login pelo navegador, copie `app/.env.example` para `app/.env.local` e preencha `OPENAI_API_KEY`; nunca versione esse arquivo.

### Verificações

```bash
npm run lint
npm test
npm run test:e2e
```

O teste de ponta a ponta inicializa o Codex, carrega conta/modelos/skills, armazena um arquivo local, envia esse arquivo ao agente e confirma a resposta da LLM em streaming.

### Limite honesto

O InDev integra a superfície pública disponível no Codex App Server; ele não copia serviços proprietários internos da OpenAI nem promete paridade com partes que não foram publicadas. O transporte WebSocket do App Server ainda é experimental, por isso esta versão o limita ao computador local. A base atual, porém, já é um harness funcional e não apenas uma tela simulada.

## Primeira hipótese de público

Pessoas e pequenas equipes que desenvolvem software e querem um agente de IA que trabalhe dentro do projeto, com contexto e transparência — não apenas gere trechos isolados de código.

## Mapa inicial

### 1. Problema

- Qual dor concreta queremos resolver?
- Em que momento ela aparece?
- Como as pessoas lidam com isso hoje?

### 2. Pessoas usuárias

- Quem usará o InDev primeiro?
- Quais são seus objetivos e limitações?
- O que faria essa pessoa voltar a usar o produto?

### 3. Proposta de valor

- Qual resultado o InDev entrega?
- O que o diferencia das alternativas existentes?

### 4. Primeira versão

- Qual é a menor experiência que já comprova valor?
- O que fica deliberadamente fora da versão inicial?
- Como vamos medir se ela funcionou?

## Próximos passos

1. Definir o público inicial com mais precisão.
2. Escolher o primeiro ambiente: aplicativo desktop, extensão de editor ou web.
3. Listar as três funcionalidades essenciais da primeira versão.
4. Decidir quais modelos de IA poderão ser usados inicialmente.
5. Validar a hipótese com pessoas desenvolvedoras reais.

## Decisões

| Data | Decisão | Motivo |
| --- | --- | --- |
| 2026-08-26 | Repositório criado | Centralizar o mapeamento e a evolução da ideia. |
| 2026-08-26 | InDev como ambiente de desenvolvimento com IA | Focar no produto e na experiência, combinando modelos de IA existentes em vez de tentar treinar um modelo de fronteira do zero. |
| 2026-08-26 | Interface de conversa com painel lateral de tarefa | Tornar visível o trabalho do agente: arquivos, execuções, resultados e aprovações. |
