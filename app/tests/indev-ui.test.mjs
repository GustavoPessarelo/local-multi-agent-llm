import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("o visual usa o provedor de modelos local compatível com OpenAI", async () => {
  const [page, provider, messageRoute, envExample] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/local-model.ts", root), "utf8"),
    readFile(new URL("app/api/threads/[threadId]/messages/route.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);

  assert.match(page, /startLocalThread/);
  assert.match(page, /Modelo local está pensando/);
  assert.match(messageRoute, /text\/event-stream/);
  assert.match(provider, /INDEV_LOCAL_BASE_URL/);
  assert.match(provider, /chat\/completions/);
  assert.match(provider, /localhost/);
  assert.match(messageRoute, /localChatStream/);
  assert.match(messageRoute, /completionEvents/);
  assert.doesNotMatch(messageRoute, /OPENAI_API_KEY|new OpenAI/);
  assert.match(envExample, /INDEV_DEFAULT_MODEL=google\/gemma-3-4b/);
});

test("arquivos, sandbox e tools locais mantêm suas proteções de execução", async () => {
  const [page, registry] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("tools/registry.mjs", root), "utf8"),
  ]);

  for (const capability of [
    "fs/writeFile",
    "fs/readDirectory",
    "thread/compact/start",
    "turn/interrupt",
    "item/commandExecution/outputDelta",
    "workspace-write",
    "read-only",
    "item/tool/call",
    "dynamicTools",
  ]) assert.match(page, new RegExp(capability.replace("/", "\\/")));
  assert.match(page, /Aguardando sua aprovação de custo/);
  assert.match(page, /Autorizar e executar/);
  assert.match(page, /approval\.preview\.approvalToken/);
  assert.match(registry, /toolCatalog/);
  assert.match(registry, /executeTool/);
  assert.match(registry, /toolRequiresApproval/);
});

test("Excel é extraído e enviado como contexto legível", async () => {
  const [page, extractor, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/spreadsheet-context.ts", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(packageJson, /"read-excel-file": "9\.3\.10"/);
  assert.match(extractor, /readXlsxFile/);
  assert.match(extractor, /MAX_CONTEXT_CHARACTERS/);
  assert.match(page, /contextPath/);
  assert.match(page, /conteúdo extraído/);
  assert.match(page, /isLegacyExcelWorkbook/);
});

test("resultados locais viram prévia e download dentro do InDev", async () => {
  const [page, artifacts] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/artifacts.ts", root), "utf8"),
  ]);

  for (const capability of ["fs/readFile", "fs/getMetadata", "fs/watch", "fs/changed"]) {
    assert.match(page, new RegExp(capability.replace("/", "\\/")));
  }
  assert.match(page, /artifact-preview/);
  assert.match(page, /Baixar ZIP/);
  assert.match(page, /Somente os resultados finais que você pediu/);
  assert.match(page, /artifact\.role === "output"/);
  assert.match(page, /Bastidores/);
  assert.match(page, /artifact\.role === "input" && artifact\.threadInput/);
  assert.match(page, /"\.git", "\.indev", "node_modules"/);
  assert.match(page, /threadUploadDirectory\(cwd, threadId\)/);
  assert.match(page, /hydrateThreadUploads/);
  assert.match(page, /ATTACHED_FILE_LINE/);
  assert.match(page, /"thread\/read"/);
  assert.match(page, /if \(turnActiveRef\.current\)/);
  assert.match(page, /"turn\/interrupt", \{ threadId, turnId \}/);
  assert.match(page, /activeTurnIdRef/);
  assert.match(page, /Preparando a resposta/);
  assert.match(page, /className={`plan-step/);
  assert.match(page, /aria-expanded={expanded}/);
  assert.match(page, /O QUE FOI FEITO/);
  assert.match(page, /sandbox="allow-scripts allow-forms allow-modals allow-downloads"/);
  assert.match(artifacts, /messageWithoutLocalPaths/);
  assert.match(artifacts, /isPathInsideWorkspace/);
});

test("o comando padrão inicia a interface local", async () => {
  const [packageJson, launcher, runtime] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("scripts/indev-dev.mjs", root), "utf8"),
    readFile(new URL("scripts/indev-runtime.mjs", root), "utf8"),
  ]);

  assert.match(packageJson, /"dev": "node scripts\/indev-dev\.mjs"/);
  assert.match(launcher, /vinextEntrypoint/);
  assert.doesNotMatch(launcher, /app-server|codex-bridge|codexEntrypoint/);
  assert.match(runtime, /INDEV_LOCAL_BASE_URL/);
});
