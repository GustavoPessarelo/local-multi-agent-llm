import { createServer } from "node:http";
import { getRuntimeConfig, workspaceRoot } from "./indev-runtime.mjs";
import { executeTool, previewTool, toolCatalog } from "../tools/registry.mjs";

const runtime = getRuntimeConfig();
const send = (response, status, body) => response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
const readJson = async (request) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return raw ? JSON.parse(raw) : {};
};
const contextFor = (body) => ({ threadId: typeof body.threadId === "string" ? body.threadId : "sem-chat", cwd: workspaceRoot });

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", runtime.toolServerUrl);
    if (request.method === "GET" && url.pathname === "/readyz") return send(response, 200, { ok: true });
    if (request.method === "GET" && url.pathname === "/tools/catalog") return send(response, 200, { tools: toolCatalog() });
    if (request.method !== "POST" || !["/tools/preview", "/tools/execute"].includes(url.pathname)) return send(response, 404, { error: "Rota não encontrada." });
    const body = await readJson(request);
    if (typeof body.tool !== "string") return send(response, 400, { error: "Tool obrigatória." });
    const action = url.pathname === "/tools/preview" ? previewTool : executeTool;
    const result = await action(body.tool, body.arguments || {}, contextFor(body));
    return send(response, 200, result);
  } catch (error) {
    return send(response, 400, { error: error instanceof Error ? error.message : "Falha na tool local." });
  }
}).listen(runtime.toolServerPort, "127.0.0.1", () => console.log(`[indev] Serviço de tools: ${runtime.toolServerUrl}`));
