import { appendAssistantMessage, appendUserMessage, getThread } from "@/lib/agent-store";
import { completionEvents, localChatStream, localChatStructured } from "@/lib/local-model";
import { createPendingLocalTool } from "@/lib/local-tool-store";
import { requestToolService } from "@/lib/tool-service";

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  const thread = getThread(threadId);
  if (!thread) return Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.content !== "string" || !body.content.trim()) {
    return Response.json({ error: "Uma mensagem é obrigatória." }, { status: 400 });
  }
  appendUserMessage(thread, body.content.trim());
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : process.env.INDEV_DEFAULT_MODEL;
  if (!model) return Response.json({ error: "Selecione um modelo local antes de enviar a mensagem." }, { status: 400 });
  const selectedTools = new Set(Array.isArray(body.tools) ? body.tools.filter((name): name is string => typeof name === "string") : []);
  const catalog = selectedTools.size ? await requestToolService<{ tools: Array<{ spec: { name: string; description: string; inputSchema: Record<string, unknown> } }> }>("/tools/catalog") : { tools: [] };
  const enabledTools = catalog.tools.filter((entry) => selectedTools.has(entry.spec.name)).map((entry) => entry.spec);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let answer = "";
      try {
        if (enabledTools.length) {
          const names = enabledTools.map((tool) => tool.name);
          const decision = await localChatStructured(model, [{
            role: "system",
            content: `Você é o InDev, um assistente de desenvolvimento local. Você decide se deve responder ou solicitar uma tool. Tools permitidas:\n${enabledTools.map((tool) => `- ${tool.name}: ${tool.description}\nSchema: ${JSON.stringify(tool.inputSchema)}`).join("\n")}\nResponda JSON. Para usar tool, tipo=tool_call, tool deve ser uma das opções e argumentos deve obedecer ao schema. Para responder diretamente, tipo=response, use resposta e deixe tool vazio e argumentos {}.`,
          }, ...thread.messages.map((message) => ({ role: message.role, content: message.content }))], {
            type: "object", additionalProperties: false,
            properties: { tipo: { enum: ["response", "tool_call"] }, resposta: { type: "string" }, tool: { enum: ["", ...names] }, argumentos: { type: "object" } },
            required: ["tipo", "resposta", "tool", "argumentos"],
          });
          if (decision.tipo === "tool_call" && typeof decision.tool === "string" && names.includes(decision.tool) && decision.argumentos && typeof decision.argumentos === "object" && !Array.isArray(decision.argumentos)) {
            const pending = createPendingLocalTool({ threadId, model, name: decision.tool, arguments: decision.argumentos as Record<string, unknown> });
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_call", approvalId: pending.id, tool: pending.name, arguments: pending.arguments })}\n\n`));
          } else {
            answer = typeof decision.resposta === "string" ? decision.resposta : "Não recebi uma resposta do modelo.";
            appendAssistantMessage(thread, answer);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", text: answer })}\n\n`));
          }
          controller.enqueue(encoder.encode("data: {\"type\":\"done\"}\n\n"));
          return;
        }
        const response = await localChatStream(model, [
          { role: "system", content: "Você é o InDev, um assistente de desenvolvimento local. Seja objetivo e não alegue executar ferramentas que não estão conectadas." },
          ...thread.messages.map((message) => ({ role: message.role, content: message.content })),
        ]);
        for await (const event of completionEvents(response)) {
          if (event.type === "delta") {
            answer += event.text;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } else if (event.type === "tool_call") {
            const pending = createPendingLocalTool({ threadId, model, name: event.call.name, arguments: event.call.arguments });
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_call", approvalId: pending.id, tool: pending.name, arguments: pending.arguments })}\n\n`));
          }
        }
        if (answer) appendAssistantMessage(thread, answer);
        controller.enqueue(encoder.encode("data: {\"type\":\"done\"}\n\n"));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Não foi possível comunicar com o modelo local.";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
