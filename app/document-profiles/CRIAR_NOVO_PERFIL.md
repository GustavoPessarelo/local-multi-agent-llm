# Como adicionar um perfil de documento

Cada perfil fica em `app/document-profiles/<id>/` e é usado pela mesma tool `renderizar_documento`.

```text
document-profiles/meu-perfil/
├── profile.json
├── styles.css
└── assets/
    └── logo.svg
```

## Passos

1. Copie a estrutura do perfil `itau` e escolha um identificador com letras minúsculas e hífens.
2. Atualize `profile.json` com nome, versão, paleta, origem e observações de uso da marca.
3. Substitua `assets/logo.svg` por um arquivo autorizado e autossuficiente.
4. Ajuste somente `styles.css`; não coloque instruções visuais extensas na descrição da tool ou da skill.
5. Crie uma skill curta apenas quando o perfil também exigir regras editoriais ou semânticas próprias.
6. Adicione um teste que renderize Markdown, confirme o perfil e verifique a presença do logo embutido.
7. Reinicie o InDev e abra um chat novo para o catálogo atualizado ser enviado ao agente.

O renderizador bloqueia HTML cru e imagens externas presentes no Markdown. O HTML final incorpora CSS e logo, portanto continua funcionando offline.
