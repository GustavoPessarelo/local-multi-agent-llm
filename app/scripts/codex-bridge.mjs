import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { getRuntimeConfig } from "./indev-runtime.mjs";
import { executeTool, previewTool, toolCatalog, toolRequiresApproval } from "../tools/registry.mjs";

const runtime = getRuntimeConfig();

const allowedOrigins = new Set([
  `http://localhost:${runtime.webPort}`,
  `http://127.0.0.1:${runtime.webPort}`,
  ...(process.env.INDEV_ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean),
]);
const pendingToolApprovals = new Map();
const TOOL_APPROVAL_TTL_MS = 30 * 60 * 1_000;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function toolFingerprint(name, args, context) {
  return createHash("sha256").update(JSON.stringify(stableValue({ name, args, context }))).digest("hex");
}

function issueToolApproval(name, args, context) {
  for (const [token, approval] of pendingToolApprovals) {
    if (approval.expiresAt < Date.now()) pendingToolApprovals.delete(token);
  }
  const token = randomUUID();
  pendingToolApprovals.set(token, {
    fingerprint: toolFingerprint(name, args, context),
    expiresAt: Date.now() + TOOL_APPROVAL_TTL_MS,
  });
  return token;
}

function consumeToolApproval(token, name, args, context) {
  const approval = typeof token === "string" ? pendingToolApprovals.get(token) : null;
  if (typeof token === "string") pendingToolApprovals.delete(token);
  if (!approval || approval.expiresAt < Date.now() || approval.fingerprint !== toolFingerprint(name, args, context)) {
    throw new Error("A aprovação da tool está ausente, expirou ou não corresponde a esta operação. Gere uma nova prévia.");
  }
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  return origin && allowedOrigins.has(origin)
    ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS", vary: "Origin" }
    : {};
}

function json(response, status, payload, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("A requisição da tool excedeu 1 MB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function toolContext(body) {
  if (!body || typeof body !== "object") throw new Error("Requisição de tool inválida.");
  if (typeof body.tool !== "string" || !body.tool) throw new Error("Nome da tool ausente.");
  if (typeof body.threadId !== "string" || !body.threadId) throw new Error("Chat da tool ausente.");
  if (typeof body.cwd !== "string" || !body.cwd) throw new Error("Área de trabalho da tool ausente.");
  return {
    name: body.tool,
    args: body.arguments && typeof body.arguments === "object" ? body.arguments : {},
    context: { threadId: body.threadId, cwd: body.cwd },
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (request.url === "/readyz") {
    json(response, 200, { ready: true, upstream: runtime.appServerWs });
    return;
  }
  if (!request.headers.origin || !allowedOrigins.has(request.headers.origin)) {
    json(response, 403, { error: "Origem não autorizada." });
    return;
  }
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS" && url.pathname.startsWith("/tools/")) {
    response.writeHead(204, headers).end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/tools/catalog") {
    json(response, 200, { tools: toolCatalog() }, headers);
    return;
  }
  if (request.method === "POST" && (url.pathname === "/tools/preview" || url.pathname === "/tools/execute")) {
    try {
      const body = await readJson(request);
      const { name, args, context } = toolContext(body);
      let result;
      if (url.pathname.endsWith("preview")) {
        result = await previewTool(name, args, context);
        if (result.approvalRequired) result = { ...result, approvalToken: issueToolApproval(name, args, context) };
      } else {
        if (toolRequiresApproval(name)) consumeToolApproval(body.approvalToken, name, args, context);
        result = await executeTool(name, args, context);
      }
      json(response, 200, result, headers);
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : "Falha ao executar a tool." }, headers);
    }
    return;
  }
  json(response, 404, { error: "Rota não encontrada." }, headers);
});

const browserServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  browserServer.handleUpgrade(request, socket, head, (client) => browserServer.emit("connection", client, request));
});

browserServer.on("connection", (client) => {
  const upstream = new WebSocket(runtime.appServerWs);
  const queued = [];

  client.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else if (upstream.readyState === WebSocket.CONNECTING) queued.push([data, isBinary]);
  });
  upstream.on("open", () => {
    for (const [data, isBinary] of queued.splice(0)) upstream.send(data, { binary: isBinary });
  });
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  upstream.on("error", () => client.close(1011, "Codex App Server indisponível"));
  upstream.on("close", () => client.close());
  client.on("close", () => upstream.close());
  client.on("error", () => upstream.close());
});

server.listen(runtime.bridgePort, "127.0.0.1", () => {
  console.log(`[indev] Ponte segura do navegador: ${runtime.bridgeWs}`);
});

function shutdown() {
  for (const client of browserServer.clients) client.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
