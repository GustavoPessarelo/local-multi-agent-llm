# InDev — runtime local

Esta aplicação executa uma interface local para modelos servidos na própria máquina por uma API compatível com OpenAI. A configuração padrão aponta para `http://localhost:1234/v1` e usa `google/gemma-3-4b`.

## Requisitos

- Node.js 22.13 ou superior, acompanhado de npm.
- Um servidor local de modelos em execução, com endpoint `/v1/models` e `/v1/chat/completions`.
- Internet somente para a instalação inicial das dependências; a inferência não usa OpenAI, Codex ou outro serviço externo.

## Configuração

Copie `.env.example` para `.env.local` se precisar alterar o modelo ou o servidor:

```env
INDEV_LOCAL_BASE_URL=http://localhost:1234/v1
INDEV_DEFAULT_MODEL=google/gemma-3-4b
```

Por segurança, o backend aceita somente URLs `localhost`, `127.0.0.1` ou `::1` para o modelo.

## Executar

```bash
npm ci
npm run doctor
npm run dev
```

Abra `http://localhost:3001`.

## Verificar

```bash
npm run lint
npm test
npm run build
```

O primeiro marco da migração local é chat em streaming e catálogo de modelos. A execução de tools, sandbox de containers e fluxos multiagente/Langflow serão conectados em etapas posteriores.
