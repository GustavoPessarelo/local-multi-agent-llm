import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { appRoot, getRuntimeConfig, loadLocalEnvironment, vinextEntrypoint } from "./indev-runtime.mjs";

loadLocalEnvironment();
const runtime = getRuntimeConfig();

async function portAvailable(port) { return new Promise((resolveCheck) => {
  const probe = createServer();
  probe.once("error", () => resolveCheck(false));
  probe.listen(port, "127.0.0.1", () => probe.close(() => resolveCheck(true)));
}); }
for (const [label, port] of [["interface", runtime.webPort], ["serviço de tools", runtime.toolServerPort]]) {
  if (!await portAvailable(port)) throw new Error(`A porta ${port} do ${label} já está em uso.`);
}

console.log(`[indev] Interface local: http://127.0.0.1:${runtime.webPort}`);
console.log(`[indev] Servidor de modelos local: ${runtime.localModelBaseUrl}`);
const tools = spawn(process.execPath, ["scripts/tools-server.mjs"], { cwd: appRoot, stdio: "inherit", env: runtime.env });
const web = spawn(process.execPath, [vinextEntrypoint, "dev", "--hostname", "127.0.0.1", "--port", String(runtime.webPort)], {
  cwd: appRoot,
  stdio: "inherit",
  env: runtime.env,
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { tools.kill(signal); web.kill(signal); });
web.on("exit", (code) => { tools.kill("SIGTERM"); process.exit(code ?? 0); });
