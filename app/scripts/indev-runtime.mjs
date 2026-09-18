import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const workspaceRoot = resolve(appRoot, "..");
export const vinextEntrypoint = resolve(appRoot, "node_modules", "vinext", "dist", "cli.js");
export const defaultLocalModelBaseUrl = "http://127.0.0.1:1234/v1";

function port(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback;
}

export function loadLocalEnvironment() {
  for (const file of [resolve(appRoot, ".env.local"), resolve(appRoot, ".env")]) {
    if (existsSync(file)) loadEnvFile(file);
  }
}

export function getRuntimeConfig(overrides = {}) {
  const source = { ...process.env, ...overrides };
  const webPort = port(source.INDEV_WEB_PORT, 3001);
  const toolServerPort = port(source.INDEV_TOOL_SERVER_PORT, 4502);
  const localModelBaseUrl = String(source.INDEV_LOCAL_BASE_URL || defaultLocalModelBaseUrl).replace(/\/+$/, "");

  return {
    webPort,
    webOrigin: `http://127.0.0.1:${webPort}`,
    toolServerPort,
    toolServerUrl: `http://127.0.0.1:${toolServerPort}`,
    localModelBaseUrl,
    env: {
      ...source,
      INDEV_WEB_PORT: String(webPort),
      INDEV_TOOL_SERVER_PORT: String(toolServerPort),
      WRANGLER_LOG_PATH: resolve(appRoot, ".wrangler", "wrangler.log"),
    },
  };
}
