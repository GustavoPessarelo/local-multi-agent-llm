import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("o visual usa o Codex App Server e mantém a Responses API como reserva", async () => {
  const [page, client, fallbackRoute, envExample] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/codex-app-client.ts", root), "utf8"),
    readFile(new URL("app/api/threads/[threadId]/messages/route.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);

  assert.match(client, /ws:\/\/127\.0\.0\.1:4502/);
  assert.match(client, /"initialize"/);
  assert.match(page, /"thread\/start"/);
  assert.match(page, /"turn\/start"/);
  assert.match(page, /item\/agentMessage\/delta/);
  assert.match(page, /requestApproval/);
  assert.match(page, /startResponsesFallback/);
  assert.match(page, /DEFAULT_CHAT_MODEL = "gpt-5\.6-luna"/);
  assert.match(page, /createCodexThread\(client, preferredModel, availableTools\)/);
  assert.match(fallbackRoute, /process\.env\.OPENAI_MODEL \|\| "gpt-5\.6-luna"/);
  assert.match(envExample, /OPENAI_MODEL=gpt-5\.6-luna/);
});

test("arquivos, skills, sandbox, terminal e comandos estão ligados ao protocolo", async () => {
  const [page, bridge] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("scripts/codex-bridge.mjs", root), "utf8"),
  ]);

  for (const capability of [
    "fs/writeFile",
    "fs/readDirectory",
    "skills/list",
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
  assert.match(bridge, /tools\/catalog/);
  assert.match(bridge, /executeTool/);
  assert.match(bridge, /consumeToolApproval/);
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

test("o comando padrão inicia a interface local e o App Server incluído no projeto", async () => {
  const [packageJson, launcher, runtime] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("scripts/indev-dev.mjs", root), "utf8"),
    readFile(new URL("scripts/indev-runtime.mjs", root), "utf8"),
  ]);

  assert.match(packageJson, /"dev": "node scripts\/indev-dev\.mjs"/);
  assert.match(packageJson, /"@openai\/codex": "0\.150\.0"/);
  assert.match(launcher, /codexEntrypoint/);
  assert.match(launcher, /app-server/);
  assert.match(launcher, /codex-bridge/);
  assert.match(launcher, /vinextEntrypoint/);
  assert.match(runtime, /node_modules.*@openai.*codex/s);
  assert.match(runtime, /CODEX_HOME/);
  assert.doesNotMatch(launcher, /spawn\("codex"/);
});
