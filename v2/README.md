# Local Agent Studio

Plataforma local em Angular e Django para conversar com LLMs, executar tools e
montar sistemas multiagentes em um canvas low-code. A aplicação usa somente um
servidor de inferência OpenAI-compatible em loopback e rejeita endpoints de
modelos externos.

## O que já funciona

- chat single-agent e multiagente com streaming;
- flows versionados com agente root e arestas de delegação dirigidas;
- acompanhamento em tempo real e cancelamento da execução;
- painel de rastreabilidade por resposta, com agentes, delegações, memória,
  tools, resultados intermediários e duração;
- memória episódica, longa e de projeto;
- resources locais e tools com aprovação explícita;
- autenticação interna por CSV;
- profiling opcional por conversa;
- frontend acessível pela rede privada, mantendo Django e a LLM em localhost.

## Arquitetura

```text
Navegador :4200
    │
    ▼
Angular ──proxy /api──► Django :8000 ──► SQLite
                            │
                            ├──► worker persistente de agentes
                            ├──► memória/resources/tools locais
                            └──► API OpenAI-compatible :1234
                                      └──► modelo carregado localmente
```

O frontend nunca chama a LLM diretamente. O backend aceita apenas
`127.0.0.1`, `localhost` ou `::1` em `LOCAL_LLM_BASE_URL`.

## Requisitos

No Windows, instale:

- Git;
- Python 3.11 ou superior;
- Node.js 22 LTS ou 24, com npm;
- LM Studio ou LM Studio Bionic;
- um modelo de chat local, como Gemma, Qwen ou Llama.

Confira a instalação:

```powershell
git --version
py --version
node --version
npm --version
```

## 1. Clonar o repositório

```powershell
git clone https://github.com/GustavoPessarelo/local-multi-agent-llm.git
cd local-multi-agent-llm
```

## 2. Criar o ambiente Python

Python 3.11 é a opção conservadora. Se ele estiver instalado:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r backend\requirements.txt
```

Também é possível usar uma versão mais nova:

```powershell
py -3.14 -m venv .venv314
.\.venv314\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r backend\requirements.txt
```

O launcher procura primeiro `.venv314` e depois `.venv`. Se o PowerShell
bloquear a ativação, libere scripts apenas para a sessão atual:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

## 3. Instalar o frontend

O `package-lock.json` já fixa as versões usadas pelo projeto:

```powershell
cd frontend
npm ci
cd ..
```

Use `npm install` somente quando estiver alterando dependências. Avisos de
`funding` não impedem o projeto de funcionar. Antes de aplicar correções
automáticas de auditoria com `--force`, confira se elas trocam versões major.

## 4. Instalar LM Studio ou Bionic

Baixe o instalador na [página oficial do LM Studio](https://lmstudio.ai/download).
Bionic é um aplicativo separado, feito para fluxos agentic, mas utiliza o mesmo
runtime local. Para este projeto, o que importa é habilitar sua API local
OpenAI-compatible.

### Opção A — LM Studio

1. Abra o LM Studio.
2. Vá em **Discover** e baixe um modelo que caiba na RAM/VRAM disponível. Uma
   quantização de 4 bits costuma ser um bom ponto de partida.
3. Carregue o modelo em **Chat** ou **Developer**.
4. Abra **Developer** e ative **Start server**.
5. Confira a porta exibida. O padrão é `1234`.

O servidor também pode ser iniciado pela CLI:

```powershell
lms server start --port 1234
```

Consulte a documentação oficial de
[servidor local](https://lmstudio.ai/docs/developer/core/server) e dos
[endpoints OpenAI-compatible](https://lmstudio.ai/docs/developer/openai-compat).

### Opção B — LM Studio Bionic

1. Abra **Settings → Local Models → Explore**.
2. Baixe um modelo local e confirme que ele aparece em **Library**.
3. Abra **Settings → Local Model API**.
4. Ative o servidor de API local.
5. Copie o endereço e a porta mostrados, normalmente
   `http://127.0.0.1:1234`.

Veja o guia oficial para
[baixar modelos no Bionic](https://lmstudio.ai/docs/bionic/models/download-local-models).
Não selecione um modelo cloud se o objetivo for manter toda a inferência local.

### Testar a API local

Com o servidor ativo, execute:

```powershell
Invoke-RestMethod http://127.0.0.1:1234/v1/models
```

A resposta precisa conter `data` e pelo menos um identificador de modelo. Para
testar uma geração, substitua o valor de `model` por um ID retornado acima:

```powershell
$body = @{
  model = "google/gemma-3-4b"
  messages = @(@{ role = "user"; content = "Responda apenas: API local OK" })
  stream = $false
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Uri http://127.0.0.1:1234/v1/chat/completions `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

## 5. Configurar o `.env`

Crie a configuração local:

```powershell
Copy-Item .env.example .env
```

Exemplo:

```dotenv
LOCAL_LLM_BASE_URL=http://127.0.0.1:1234/v1
LOCAL_LLM_DEFAULT_MODEL=google/gemma-3-4b
LOCAL_EMBEDDING_MODEL=text-embedding-nomic-embed-text-v1.5
LAN_ACCESS=false
DJANGO_SECRET_KEY=troque-esta-chave
DJANGO_DEBUG=true
```

- `LOCAL_LLM_BASE_URL`: use a porta exibida no LM Studio/Bionic e mantenha
  `/v1` no final;
- `LOCAL_LLM_DEFAULT_MODEL`: ID exato retornado por `/v1/models`;
- `LOCAL_EMBEDDING_MODEL`: modelo local de embeddings; se não estiver
  carregado, a busca usa fallback lexical;
- `LAN_ACCESS=true`: expõe somente o Angular na rede privada pela porta 4200;
- `.env`, banco, modelos, uploads, logs e credenciais não entram no Git.

## 6. Preparar o banco e os exemplos

O launcher aplica migrações automaticamente, mas a preparação manual é útil
para validar a instalação:

```powershell
python backend\manage.py migrate
python backend\manage.py seed_demo_flow
```

O comando cria o projeto **Exemplo multiagente** com três flows:

1. **Planejar, redigir e revisar** — Planejador → Redator → Revisor;
2. **Laboratório de código** — Arquiteto → Desenvolvedor → QA;
3. **Conselho crítico** — Analista → Crítico → Sintetizador.

Ele pode ser executado novamente sem duplicar flows. Quando um exemplo muda,
uma nova versão do flow é criada.

## 7. Iniciar a aplicação

Deixe o modelo carregado e a API local ativa. Na raiz do repositório:

```powershell
.\scripts\dev.ps1
```

O script inicia:

- Angular: `http://127.0.0.1:4200`;
- Django: `http://127.0.0.1:8000`;
- worker persistente de agentes.

Abra somente:

```text
http://localhost:4200
```

Credencial criada automaticamente na primeira execução:

```text
Usuário: admin
Senha: localagent2026
```

As credenciais ficam em `data/auth/users.csv`, nas colunas `usuario,senha`.
Essa autenticação é adequada apenas para uso interno/local e não armazena
senhas com hash.

Para encerrar processos iniciados no terminal, pressione `Ctrl+C`. Como o
launcher abre alguns processos em segundo plano no Windows, se uma porta ficar
ocupada confira o PID:

```powershell
netstat -ano | findstr :4200
netstat -ano | findstr :8000
```

Encerre somente o PID identificado para este projeto:

```powershell
Stop-Process -Id 12345
```

## Como testar os exemplos

1. Entre no sistema.
2. Selecione **Exemplo multiagente**.
3. Abra uma das conversas de teste.
4. No seletor superior, troque **Agente único** pelo flow correspondente.
5. Envie uma tarefa.
6. Acompanhe os agentes na timeline.
7. Depois da resposta, clique em **Rastreabilidade** para inspecionar entradas,
   memória, decisões, delegações, resultados e duração.

Sugestões:

```text
Laboratório de código:
Crie uma função Python que agrupe vendas por categoria e valide entradas vazias.

Conselho crítico:
Compare SQLite e PostgreSQL para um produto local-first com sincronização futura.
```

## Como criar flows funcionais

### Modelo mental

- cada caixa é um agente com nome e `system prompt`;
- exatamente um agente precisa ser o **root**;
- uma aresta `A → B` significa que A pode invocar B;
- a execução começa no root e termina quando um agente produz `FINAL`;
- o grafo não pode possuir ciclos;
- o runtime limita a execução a oito delegações e duas visitas por agente.

### Passo a passo no canvas

1. Abra **Flows** e clique em **Em branco**.
2. Adicione os agentes.
3. Selecione cada agente e escreva apenas seu system prompt.
4. Selecione o primeiro agente e clique em **Definir como root**.
5. Para criar uma aresta, clique no botão `+` do agente de origem e depois no
   card do agente de destino.
6. Confira a seta e a lista de delegações no inspetor.
7. Clique em **Salvar versão**.
8. Volte ao Chat e selecione o flow no topo antes de enviar a mensagem.

### Prompts que delegam com confiabilidade

Modelos pequenos obedecem melhor a instruções explícitas. Para um agente que
deve sempre chamar `reviewer`, use:

```text
Analise e produza um rascunho. Não entregue a resposta final.
Delegue obrigatoriamente ao Revisor.
Na primeira linha escreva exatamente: DELEGATE reviewer
Na segunda linha comece com TASK: e inclua todo o material para revisão.
```

Para o último agente:

```text
Revise o material recebido e entregue a resposta ao usuário.
Na primeira linha escreva exatamente: FINAL
Nas linhas seguintes escreva somente a resposta final.
```

O ID usado depois de `DELEGATE` é o ID interno do nó, não apenas seu nome
visual. O runtime acrescenta automaticamente ao prompt os IDs permitidos pelas
arestas. Evite pedir ao mesmo agente para “responder” e “delegar” ao mesmo tempo.

### Checklist de diagnóstico

Se apenas o primeiro agente executar:

- confirme que a aresta foi criada e que o flow foi salvo;
- confira se o agente root está correto;
- deixe explícito no prompt que a delegação é obrigatória;
- abra **Rastreabilidade → Protocolo de roteamento**;
- verifique se a resposta começou com `DELEGATE <id>`;
- tente um modelo instruct mais obediente ou uma quantização menos agressiva.

## Tools, resources e memória

Em **Configuração**:

- envie arquivos em **Resources**;
- habilite as tools que o chat pode solicitar;
- aprove cada execução antes que a tool acesse o resource;
- cadastre memória de projeto, longa ou episódica;
- use a busca local para verificar o conteúdo recuperável.

O profiling é ativado pela caixa **Profiling ativo** no compositor. Os arquivos
JSON são gravados em `data/profiling/`.

## Acesso pela rede local

Defina `LAN_ACCESS=true` no `.env`, reinicie o launcher e permita TCP/4200 no
perfil **Privado** do Firewall do Windows. Descubra o IP com `ipconfig` e acesse:

```text
http://IP-DO-PC:4200
```

Django e a API da LLM permanecem em loopback. Não encaminhe portas no roteador
e não exponha esta configuração à internet.

## Testes

```powershell
python backend\manage.py test core

cd frontend
npm run build
cd ..
```

## Estrutura

```text
backend/             Django, API, worker, memória, tools e persistência
frontend/            Angular e editor visual de flows
scripts/dev.ps1      launcher local
data/                banco auxiliar, uploads, usuários e profiling (ignorado)
.logs/               locks e logs locais (ignorado)
.env.example         configuração de referência
```

## Limitações atuais

- autenticação CSV sem hash, indicada apenas para ambiente interno;
- um mesmo modelo normalmente atende todos os agentes para economizar VRAM;
- a qualidade do roteamento depende da capacidade do modelo seguir o protocolo;
- a trilha mostra decisões operacionais e resultados intermediários, não o
  raciocínio interno privado do modelo;
- não há sandbox de sistema operacional para execução arbitrária de código.
