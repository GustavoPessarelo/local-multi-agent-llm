import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  appRoot,
  assertLocalDependencies,
  codexEntrypoint,
  ensureRuntimeFolders,
  getRuntimeConfig,
  loadLocalEnvironment,
  vinextEntrypoint,
  workspaceRoot,
} from "./indev-runtime.mjs";

loadLocalEnvironment();
ensureRuntimeFolders();
assertLocalDependencies();

const runtime = getRuntimeConfig();
const children = [];

function portIsAvailable(port) {
  return new Promise((resolveCheck) => {
    const probe = createServer();
    probe.once("error", () => resolveCheck(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolveCheck(true)));
  });
}

async function appServerIsReady() {
  try {
    const response = await fetch(runtime.appServerReady, { signal: AbortSignal.timeout(700) });
    return response.ok;
  } catch {
    return false;
  }
}

async function bridgeIsReady() {
  try {
    const response = await fetch(runtime.bridgeReady, { signal: AbortSignal.timeout(700) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntil(check, label) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`${label} não iniciou.`);
}

function start(command, args, cwd, label) {
  const child = spawn(command, args, { cwd, stdio: "inherit", env: runtime.env });
  children.push(child);
  child.on("error", (error) => console.error(`[${label}] ${error.message}`));
  return child;
}

let web;
try {
  for (const [label, port] of [["interface", runtime.webPort], ["App Server", runtime.appServerPort], ["ponte", runtime.bridgePort]]) {
    if (!await portIsAvailable(port)) {
      throw new Error(`A porta ${port} do ${label} já está em uso. Feche a outra execução do InDev e tente novamente.`);
    }
  }

  console.log(`[indev] Motor incluído no projeto: ${codexEntrypoint}`);
  start(process.execPath, [codexEntrypoint, "app-server", "--listen", runtime.appServerWs], workspaceRoot, "codex");
  await waitUntil(appServerIsReady, "Codex App Server");

  start(process.execPath, ["scripts/codex-bridge.mjs"], appRoot, "bridge");
  await waitUntil(bridgeIsReady, "Ponte do navegador");

  web = start(process.execPath, [vinextEntrypoint, "dev", "--hostname", "127.0.0.1", "--port", String(runtime.webPort)], appRoot, "web");
} catch (error) {
  shutdown("SIGTERM");
  console.error(`[indev] ${error instanceof Error ? error.message : "Falha ao iniciar."}`);
  process.exit(1);
}

function shutdown(signal) {
  for (const child of children) if (!child.killed) child.kill(signal);
}

process.on("SIGINT", () => { shutdown("SIGINT"); process.exit(130); });
process.on("SIGTERM", () => { shutdown("SIGTERM"); process.exit(143); });
web.on("exit", (code) => { shutdown("SIGTERM"); process.exit(code ?? 0); });
