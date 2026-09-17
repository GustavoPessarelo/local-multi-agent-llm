import test from "node:test";
import assert from "node:assert/strict";
import {
  artifactMimeType,
  artifactPreviewKind,
  extractArtifactCandidates,
  isDeliverableArtifact,
  isPathInsideWorkspace,
  messageWithoutLocalPaths,
  mergeArtifactRole,
  shouldIgnoreArtifactPath,
} from "../lib/artifacts";

test("descobre e oculta links absolutos de resultados", () => {
  const message = "Relatório pronto: [Abrir relatório](/Users/vitor/indev/relatorio\\_despesas.html)";
  assert.deepEqual(extractArtifactCandidates(message), [{ label: "Abrir relatório", path: "/Users/vitor/indev/relatorio_despesas.html" }]);
  assert.equal(messageWithoutLocalPaths(message), "Relatório pronto: 📄 Abrir relatório — disponível em Arquivos");
});

test("mantém entregas acima de entradas e arquivos de bastidor", () => {
  assert.equal(mergeArtifactRole("worker", "input"), "input");
  assert.equal(mergeArtifactRole("input", "worker"), "input");
  assert.equal(mergeArtifactRole("worker", "output"), "output");
  assert.equal(mergeArtifactRole("output", "input"), "output");
});

test("reconhece caminhos Windows e mantém o acesso limitado ao projeto", () => {
  const message = "ZIP salvo em C:\\projetos\\indev\\resultados.zip";
  assert.equal(extractArtifactCandidates(message)[0]?.path, "C:\\projetos\\indev\\resultados.zip");
  assert.equal(isPathInsideWorkspace("C:\\projetos\\indev\\resultados.zip", "C:\\projetos\\indev"), true);
  assert.equal(isPathInsideWorkspace("C:\\segredos\\dados.zip", "C:\\projetos\\indev"), false);
});

test("classifica prévias, downloads e caminhos internos ignorados", () => {
  assert.equal(artifactPreviewKind("relatorio.html"), "html");
  assert.equal(artifactPreviewKind("documentos.zip"), null);
  assert.equal(artifactMimeType("documentos.zip"), "application/zip");
  assert.equal(isDeliverableArtifact("relatorio.html"), true);
  assert.equal(isDeliverableArtifact("package.json"), false);
  assert.equal(shouldIgnoreArtifactPath("/repo/node_modules/pkg/index.js"), true);
  assert.equal(shouldIgnoreArtifactPath("/repo/outputs/relatorio.html"), false);
});
