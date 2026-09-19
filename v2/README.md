# Local Agent Studio v2

Aplicação Angular + Django para conversar e executar sistemas multiagentes com
modelos locais OpenAI-compatible. O gateway rejeita hosts externos e usa, por
padrão, `http://127.0.0.1:1234/v1`.

## Funcionalidades

- conversas independentes por projeto, títulos automáticos e renomeação;
- chat persistente com cancelamento real, eventos e tools sujeitas a aprovação;
- autenticação interna por sessão e CSV local;
- canvas de redes de agentes com system prompt, root explícito e delegações dirigidas;
- seleção e acompanhamento do flow diretamente na conversa;
- versões imutáveis de cada flow e worker local recuperável;
- profiling opcional por execução, incluindo tempos, agentes, tools e GPU quando disponível;
- memória curta, episódica, longa e de projeto;
- busca local sobre memórias e resources, com embedding local e fallback
  lexical quando o modelo de embedding não estiver carregado.

## Executar

Com o servidor de modelos aberto na porta `1234`:

```powershell
cd v2
.\scripts\dev.ps1
```

Abra apenas `http://127.0.0.1:4200`. O script aplica migrações e inicia Django,
Angular e o worker persistente de agentes. As credenciais ficam em
`data/auth/users.csv`, com as colunas `usuario,senha`.

Na primeira execução, o launcher cria a credencial local inicial
`admin / localagent2026`. Para trocar ou adicionar usuários, edite o CSV com o
aplicativo parado e mantenha uma credencial por linha.

## Primeira instalação

```powershell
cd v2
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
cd frontend
npm install
```

Neste computador, o launcher usa automaticamente `.venv314` quando presente;
ela foi criada porque a instalação anterior do Python 3.11 não está mais no
caminho registrado pelas venvs antigas.

## Ambiente local

Copie `.env.example` para `.env` somente quando quiser mudar modelos ou
configurações. O Django carrega esse arquivo automaticamente. As configurações
principais são:

- `LOCAL_LLM_BASE_URL`: endpoint OpenAI-compatible em localhost;
- `LOCAL_LLM_DEFAULT_MODEL`: modelo padrão dos agentes;
- `LOCAL_EMBEDDING_MODEL`: modelo local usado pela busca semântica.
- `LAN_ACCESS`: use `true` para expor somente o frontend na rede privada pela
  porta `4200`. Django e o servidor de modelos continuam em loopback.

O profiling ativado na conversa é salvo em `data/profiling/` com o nome da
conversa e o horário da execução. O arquivo de usuários e os logs permanecem
fora do Git por estarem dentro de `data/`.

Com `LAN_ACCESS=true`, crie uma regra de Firewall do Windows para TCP/4200 no
perfil Privado e acesse `http://IP-DO-PC:4200` a partir de outro dispositivo da
mesma rede. Não abra portas no roteador nem exponha a aplicação à internet.

## Validação

```powershell
.\.venv\Scripts\python.exe backend\manage.py test core
cd frontend
npm run build
```
