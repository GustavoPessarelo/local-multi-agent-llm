import { spawn } from "node:child_process";
import {
  appRoot,
  assertLocalDependencies,
  codexEntrypoint,
  codexHome,
  ensureRuntimeFolders,
  getRuntimeConfig,
  loadLocalEnvironment,
  workspaceRoot,
} from "./indev-runtime.mjs";

const nonInteractive = process.argv.includes("--non-interactive") || process.argv.includes("--check");
const checkOnly = process.argv.includes("--check");

function runCodex(args, { capture = false, input } = {}) {
  const { env } = getRuntimeConfig();
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [codexEntrypoint, ...args], {
      cwd: workspaceRoot,
      env,
      stdio: capture ? ["pipe", "pipe", "pipe"] : [input ? "pipe" : "inherit", "inherit", "inherit"],
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    }
    child.on("error", reject);
    child.on("exit", (code) => resolveRun({ code: code ?? 1, stdout, stderr }));
    if (input) child.stdin.end(`${input}\n`);
  });
}

const nodeVersion = process.versions.node.split(".").map(Number);
if (nodeVersion[0] < 22 || (nodeVersion[0] === 22 && nodeVersion[1] < 13)) {
  console.error(`[indev] Node.js 22.13 ou superior é necessário. Versão atual: ${process.versions.node}`);
  process.exit(1);
}

loadLocalEnvironment();
ensureRuntimeFolders();
assertLocalDependencies();

const version = await runCodex(["--version"], { capture: true });
if (version.code !== 0) {
  console.error("[indev] O Codex incluído no projeto não iniciou.");
  process.exit(version.code);
}
console.log(`[indev] ${version.stdout.trim()} carregado do próprio projeto.`);
console.log(`[indev] Dados privados locais: ${codexHome}`);

let status = await runCodex(["login", "status"], { capture: true });
if (status.code === 0) {
  console.log("[indev] Autenticação pronta.");
  process.exit(0);
}

if (!checkOnly && process.env.OPENAI_API_KEY) {
  console.log("[indev] Configurando a chave de .env.local no armazenamento privado do projeto…");
  const login = await runCodex(["login", "--with-api-key"], { input: process.env.OPENAI_API_KEY });
  if (login.code !== 0) process.exit(login.code);
  status = await runCodex(["login", "status"], { capture: true });
  if (status.code === 0) {
    console.log("[indev] Autenticação por API pronta.");
    process.exit(0);
  }
}

if (!nonInteractive && process.stdin.isTTY) {
  console.log("[indev] Abrindo o login seguro da OpenAI para esta cópia do InDev…");
  const login = await runCodex(["login"]);
  if (login.code === 0) process.exit(0);
}

console.error(`[indev] Falta autenticar. Execute "npm run setup" em ${appRoot} ou crie app/.env.local a partir de .env.example.`);
process.exit(1);
