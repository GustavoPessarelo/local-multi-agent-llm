import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { documentProfileCatalog, loadDocumentProfile } from "../document-profiles/registry.mjs";
import { executeDocumentRenderer } from "../tools/builtin/renderizar-documento.mjs";
import { toolCatalog } from "../tools/registry.mjs";

test("o catálogo registra o perfil Itaú e a tool genérica de documentos", async () => {
  const profiles = await documentProfileCatalog();
  assert.deepEqual(profiles, [{ id: "itau", displayName: "Itaú", version: "1.0.0" }]);
  const profile = await loadDocumentProfile("itau");
  assert.match(profile.logoSvg, /<svg/);
  assert.match(profile.css, /\.document-header/);

  const registered = toolCatalog().find((entry) => entry.spec.name === "renderizar_documento");
  assert.ok(registered);
  assert.equal(registered.approval.required, false);
  assert.deepEqual(registered.spec.inputSchema.required, ["perfil", "formato", "titulo", "conteudo_markdown"]);
});

test("o renderer cria HTML Itaú offline, seguro e separado por chat", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "indev-documento-"));
  try {
    const result = await executeDocumentRenderer({
      perfil: "itau",
      formato: "html",
      titulo: "Relatório Executivo de Auditoria",
      subtitulo: "Resultados validados do segundo trimestre",
      classificacao: "Documento interno",
      data_documento: "2º trimestre de 2026",
      nome_arquivo: "relatorio-auditoria",
      conteudo_markdown: `## Resumo executivo

Foram analisados **120 controles** com evidência disponível.

| Indicador | Resultado |
| --- | ---: |
| Controles analisados | 120 |
| Recomendações | 8 |

> Os números acima pertencem somente a esta demonstração automatizada.

![imagem remota](https://example.com/nao-carregar.png)

<script>alert("não executar")</script>`,
    }, { cwd: workspace, threadId: "chat/documentacao" });

    assert.equal(result.ok, true);
    assert.equal(result.perfil, "itau");
    assert.match(result.outputPath, /entregaveis[\\/]chat_documentacao[\\/]relatorio-auditoria-itau-.*\.html$/);

    const html = await readFile(result.outputPath, "utf8");
    assert.match(html, /data-document-profile="itau"/);
    assert.match(html, /class="brand-logo" src="data:image\/svg\+xml;base64,/);
    assert.match(html, /Relatório Executivo de Auditoria/);
    assert.match(html, /<div class="table-wrap"><table>/);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /Imagem externa omitida: imagem remota/);
    assert.match(html, /&lt;script&gt;alert/);
    assert.doesNotMatch(html, /<script[\s>]/i);
    assert.doesNotMatch(html, /https:\/\/example\.com/);
    assert.equal((html.match(/<img\b/g) || []).length, 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
