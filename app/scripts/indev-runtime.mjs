import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const workspaceRoot = resolve(appRoot, "..");
export const runtimeRoot = resolve(workspaceRoot, ".indev");
export const codexHome = resolve(runtimeRoot, "codex-home");
export const codexEntrypoint = resolve(appRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
export const vinextEntrypoint = resolve(appRoot, "node_modules", "vinext", "dist", "cli.js");

function port(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback;
}

export function loadLocalEnvironment() {
  for (const file of [resolve(appRoot, ".env.local"), resolve(appRoot, ".env")]) {
    if (existsSync(file)) loadEnvFile(file);
  }
}

export function ensureRuntimeFolders() {
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(resolve(runtimeRoot, "uploads"), { recursive: true });
}

export function assertLocalDependencies() {
  if (!existsSync(codexEntrypoint) || !existsSync(vinextEntrypoint)) {
    throw new Error("Dependências locais ausentes. Execute npm install dentro da pasta app.");
  }
}

export function getRuntimeConfig(overrides = {}) {
  const source = { ...process.env, ...overrides };
  const webPort = port(source.INDEV_WEB_PORT, 3001);
  const appServerPort = port(source.INDEV_APP_SERVER_PORT, 4501);
  const bridgePort = port(source.INDEV_BRIDGE_PORT, 4502);
  const selectedCodexHome = source.INDEV_CODEX_HOME
    ? resolve(String(source.INDEV_CODEX_HOME))
    : codexHome;

  return {
    webPort,
    appServerPort,
    bridgePort,
    webOrigin: `http://127.0.0.1:${webPort}`,
    appServerWs: `ws://127.0.0.1:${appServerPort}`,
    appServerReady: `http://127.0.0.1:${appServerPort}/readyz`,
    bridgeWs: `ws://127.0.0.1:${bridgePort}`,
    bridgeReady: `http://127.0.0.1:${bridgePort}/readyz`,
    env: {
      ...source,
      CODEX_HOME: selectedCodexHome,
      INDEV_WEB_PORT: String(webPort),
      INDEV_APP_SERVER_PORT: String(appServerPort),
      INDEV_BRIDGE_PORT: String(bridgePort),
      WRANGLER_LOG_PATH: resolve(appRoot, ".wrangler", "wrangler.log"),
    },
  };
}
