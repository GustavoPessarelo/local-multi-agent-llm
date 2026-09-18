import { existsSync } from "node:fs";
import { getRuntimeConfig, loadLocalEnvironment, vinextEntrypoint } from "./indev-runtime.mjs";

const nodeVersion = process.versions.node.split(".").map(Number);
if (nodeVersion[0] < 22 || (nodeVersion[0] === 22 && nodeVersion[1] < 13)) {
  console.error(`[indev] Node.js 22.13 ou superior é necessário. Versão atual: ${process.versions.node}`);
  process.exit(1);
}

loadLocalEnvironment();
const runtime = getRuntimeConfig();
if (!existsSync(vinextEntrypoint)) {
  console.error("[indev] Dependências locais ausentes. Execute npm ci dentro da pasta app.");
  process.exit(1);
}

try {
  const response = await fetch(`${runtime.localModelBaseUrl}/models`, { signal: AbortSignal.timeout(3_000) });
  const payload = await response.json();
  if (!response.ok || !Array.isArray(payload.data)) throw new Error("catálogo inválido");
  console.log(`[indev] ${payload.data.length} modelo(s) local(is) disponível(is) em ${runtime.localModelBaseUrl}.`);
} catch {
  console.error(`[indev] Não foi possível acessar ${runtime.localModelBaseUrl}/models. Inicie o servidor local de modelos e tente novamente.`);
  process.exit(1);
}
