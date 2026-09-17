import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { WebSocket } from "ws";
import {
  appRoot,
  codexEntrypoint,
  ensureRuntimeFolders,
  getRuntimeConfig,
  loadLocalEnvironment,
  workspaceRoot,
} from "../scripts/indev-runtime.mjs";

loadLocalEnvironment();
ensureRuntimeFolders();

const runtime = getRuntimeConfig({
  INDEV_APP_SERVER_PORT: "4511",
  INDEV_BRIDGE_PORT: "4512",
  INDEV_WEB_PORT: "3011",
});
const socketUrl = runtime.bridgeWs;
const browserOrigin = `http://127.0.0.1:${runtime.webPort}`;
let server;
let bridge;
let socket;

async function isReady(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(700) })).ok;
  } catch {
    return false;
  }
}

async function waitFor(url, label) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isReady(url)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  assert.fail(`${label} não iniciou`);
}

try {
  assert.equal(await isReady(runtime.appServerReady), false, "porta de teste do App Server já está em uso");
  assert.equal(await isReady(runtime.bridgeReady), false, "porta de teste da ponte já está em uso");

  server = spawn(process.execPath, [codexEntrypoint, "app-server", "--listen", runtime.appServerWs], {
    cwd: workspaceRoot,
    env: runtime.env,
    stdio: "ignore",
  });
  await waitFor(runtime.appServerReady, "Codex App Server local do projeto");

  bridge = spawn(process.execPath, [resolve(appRoot, "scripts", "codex-bridge.mjs")], {
    cwd: appRoot,
    env: runtime.env,
    stdio: "ignore",
  });
  await waitFor(runtime.bridgeReady, "ponte segura do navegador");

  socket = new WebSocket(socketUrl, { origin: browserOrigin });
  let nextId = 1;
  const pending = new Map();
  let streamed = "";
  let finishTurn;
  const turnFinished = new Promise((resolveTurn) => { finishTurn = resolveTurn; });

  const request = (method, params = {}) => new Promise((resolveRequest, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${method}`));
    }, 30_000);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined && !message.method) {
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(message.error.message));
      else call.resolve(message.result);
      return;
    }
    if (message.method === "item/agentMessage/delta") streamed += message.params.delta;
    if (message.method === "turn/completed") finishTurn(message.params.turn);
    if (message.id !== undefined && message.method?.includes("requestApproval")) {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { decision: "decline" } }));
    }
  });

  await new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout: websocket")), 4_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolveOpen();
    }, { once: true });
  });

  await request("initialize", {
    clientInfo: { name: "indev-e2e", title: "InDev E2E", version: "0.3.1" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  socket.send(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }));

  const [account, models, skills] = await Promise.all([
    request("account/read"),
    request("model/list", { limit: 3 }),
    request("skills/list"),
  ]);
  assert.ok(account.account, "conta Codex ausente");
  assert.ok(models.data.length > 0, "nenhum modelo disponível");
  assert.ok(Array.isArray(skills.data), "catálogo de skills não carregado");

  const selectedModel = models.data.find((entry) => entry.isDefault)?.model || models.data[0].model;
  const started = await request("thread/start", {
    ephemeral: true,
    model: selectedModel,
    approvalPolicy: "never",
    sandbox: "read-only",
    threadSource: "indev-e2e",
  });
  const uploadDir = resolve(started.cwd, ".indev", "uploads");
  const uploadedPath = resolve(uploadDir, "e2e-upload.txt");
  await request("fs/createDirectory", { path: uploadDir, recursive: true });
  await request("fs/writeFile", { path: uploadedPath, dataBase64: Buffer.from("UPLOAD_INDEV_OK\n").toString("base64") });
  const stored = await request("fs/readFile", { path: uploadedPath });
  assert.equal(Buffer.from(stored.dataBase64, "base64").toString(), "UPLOAD_INDEV_OK\n");

  await request("turn/start", {
    threadId: started.thread.id,
    input: [
      { type: "text", text: `Leia exatamente o caminho absoluto ${uploadedPath}. Responda apenas o código contido nesse arquivo, sem nenhuma outra palavra.`, text_elements: [] },
      { type: "mention", name: "e2e-upload.txt", path: uploadedPath },
    ],
  });
  let turnTimer;
  const turnTimeout = new Promise((_, reject) => {
    turnTimer = setTimeout(() => reject(new Error("timeout: resposta LLM")), 60_000);
  });
  const completed = await Promise.race([turnFinished, turnTimeout]);
  clearTimeout(turnTimer);
  assert.equal(completed.status, "completed");
  assert.match(streamed, /UPLOAD_INDEV_OK/);
  await request("fs/remove", { path: uploadedPath, force: true });

  const skillCount = skills.data.reduce((total, scope) => total + (scope.skills?.length || 0), 0);
  console.log(`OK: Codex do node_modules; ${models.data[0].displayName}; ${skillCount} skills; upload, leitura e streaming confirmados`);
} finally {
  socket?.close();
  server?.kill("SIGTERM");
  bridge?.kill("SIGTERM");
}
