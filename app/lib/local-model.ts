const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:1234/v1";

export type LocalModel = { id: string; object?: string };
export type LocalChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type LocalTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type LocalToolCall = { id: string; name: string; arguments: Record<string, unknown> };

function configuredBaseUrl() {
  const raw = (process.env.INDEV_LOCAL_BASE_URL || DEFAULT_LOCAL_BASE_URL).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("INDEV_LOCAL_BASE_URL precisa ser uma URL HTTP local válida.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("O provedor local precisa usar HTTP ou HTTPS.");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Por segurança, o InDev aceita apenas um servidor de modelos em localhost.");
  }
  return url.toString().replace(/\/$/, "");
}

async function localFetch(path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${configuredBaseUrl()}${path}`, init);
  } catch {
    throw new Error("Não foi possível alcançar o servidor local de modelos. Confirme se ele está ativo.");
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`O servidor local respondeu ${response.status}${detail ? `: ${detail}` : "."}`);
  }
  return response;
}

export async function listLocalModels() {
  const response = await localFetch("/models");
  const payload = await response.json() as { data?: LocalModel[] };
  return (payload.data || []).filter((model) => typeof model.id === "string" && model.id.length > 0);
}

export async function localChatStream(model: string, messages: LocalChatMessage[], tools: LocalTool[] = []) {
  return localFetch("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.2, stream: true, ...(tools.length ? { tools, tool_choice: "auto" } : {}) }),
  });
}

export async function localChatStructured(model: string, messages: LocalChatMessage[], schema: Record<string, unknown>) {
  const response = await localFetch("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_schema", json_schema: { name: "indev_tool_decision", strict: true, schema } },
      messages,
    }),
  });
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content || "";
  try { return JSON.parse(content) as Record<string, unknown>; }
  catch { throw new Error("O modelo local não retornou uma decisão JSON válida."); }
}

export async function* completionDeltas(response: Response) {
  if (!response.body) throw new Error("O servidor local não retornou um fluxo de resposta.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) {
        const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data || data === "[DONE]") continue;
        const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
        const text = payload.choices?.[0]?.delta?.content || payload.choices?.[0]?.message?.content || "";
        if (text) yield text;
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* completionEvents(response: Response) {
  if (!response.body) throw new Error("O servidor local não retornou um fluxo de resposta.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = buffer.split("\n\n"); buffer = events.pop() || "";
      for (const event of events) {
        const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data || data === "[DONE]") continue;
        const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }> };
        const delta = payload.choices?.[0]?.delta;
        if (delta?.content) yield { type: "delta", text: delta.content };
        for (const call of delta?.tool_calls || []) {
          const index = call.index || 0;
          const current = calls.get(index) || { id: "", name: "", arguments: "" };
          current.id += call.id || ""; current.name += call.function?.name || ""; current.arguments += call.function?.arguments || "";
          calls.set(index, current);
        }
      }
      if (done) break;
    }
    for (const call of calls.values()) {
      try { yield { type: "tool_call", call: { id: call.id || crypto.randomUUID(), name: call.name, arguments: JSON.parse(call.arguments || "{}") } }; }
      catch { throw new Error(`A tool '${call.name || "desconhecida"}' recebeu argumentos JSON inválidos.`); }
    }
  } finally { reader.releaseLock(); }
}

export function defaultLocalModel(models: LocalModel[]) {
  const configured = process.env.INDEV_DEFAULT_MODEL;
  return models.find((model) => model.id === configured)?.id || models[0]?.id || "";
}
