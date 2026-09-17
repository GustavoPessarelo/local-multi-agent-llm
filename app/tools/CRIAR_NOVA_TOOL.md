# Como adicionar uma nova tool ao InDev

As tools locais ficam em `app/tools/builtin/`. O registro é automático: cada arquivo `.mjs` válido nessa pasta é descoberto quando o InDev inicia.

## Passos

1. Crie `app/tools/builtin/nome-da-tool.mjs`.
2. Exporte um objeto chamado `tool` com `spec` e `execute`.
3. Adicione `approval.required=true` quando houver custo, alteração externa, envio de dados ou outra ação que precise de confirmação. O backend emitirá uma autorização curta e de uso único; sem ela, a execução é recusada.
4. Implemente `preview` quando a tela precisar mostrar um plano antes da autorização.
5. O registro valida os argumentos contra `inputSchema`. No executor, valide também regras de negócio e caminhos contra `context.cwd`, mantenha segredos somente no backend local e grave resultados dentro da área do chat.
6. Adicione testes em `app/tests/` e execute `npm run lint` e `npm test`.
7. Reinicie o InDev e abra um chat novo. O schema será enviado automaticamente ao App Server.

## Contrato mínimo

```js
export const tool = {
  spec: {
    type: "function",
    name: "minha_tool",
    description: "Explique claramente quando o modelo deve usar esta tool.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        entrada: { type: "string", description: "Dado necessário." },
      },
      required: ["entrada"],
    },
  },
  approval: { required: false },
  async execute(args, context) {
    return { ok: true, message: `Recebido: ${args.entrada}` };
  },
};
```

## Tool com aprovação

```js
export const tool = {
  spec: { /* mesmo formato acima */ },
  approval: { required: true, title: "Confirmar operação" },
  async preview(args, context) {
    return {
      approvalRequired: true,
      title: "Confirmar operação",
      summary: "Explique exatamente o que acontecerá.",
      details: ["Custo previsto", "Destino", "Quantidade"],
    };
  },
  async execute(args, context) {
    // Só é chamado depois do clique do usuário.
    return { ok: true };
  },
};
```

## Regras do registro

- Nome: letras minúsculas, números e `_`, começando por letra.
- Descrição e `inputSchema` são obrigatórios.
- Campos extras e campos obrigatórios são verificados automaticamente antes do `preview` e do `execute`.
- `_session` não é necessário: `context.threadId` e `context.cwd` identificam o chat.
- Uma tool não pode acessar arquivos fora de `context.cwd`.
- Nunca envie chaves ou tokens ao navegador; use variáveis do `.env.local` somente no executor `.mjs`.
- Para entregar um arquivo, retorne `outputPath` absoluto. O InDev o adicionará em **Entregas**.

## Perfis de documentação

Não crie uma tool nova apenas para trocar cores, logo ou papel timbrado. Use a tool genérica `renderizar_documento` e adicione um perfil em `app/document-profiles/`. Veja `app/document-profiles/CRIAR_NOVO_PERFIL.md`.
