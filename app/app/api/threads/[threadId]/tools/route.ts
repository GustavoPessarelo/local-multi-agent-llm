import { appendAssistantMessage, getThread } from "@/lib/agent-store";
import { completionEvents, localChatStream } from "@/lib/local-model";
import { consumePendingLocalTool } from "@/lib/local-tool-store";
import { requestToolService } from "@/lib/tool-service";

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  const thread = getThread(threadId);
  if (!thread) return Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const pending = typeof body.approvalId === "string" ? consumePendingLocalTool(body.approvalId, threadId) : undefined;
  if (!pending) return Response.json({ error: "A aprovação da tool expirou ou não pertence a esta tarefa." }, { status: 404 });

  try {
    await requestToolService("/tools/preview", { tool: pending.name, arguments: pending.arguments, threadId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Argumentos da tool inválidos." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let answer = "";
      try {
        const result = await requestToolService<Record<string, unknown>>("/tools/execute", { tool: pending.name, arguments: pending.arguments, threadId });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_result", tool: pending.name, result })}\n\n`));
        const resultContext = JSON.stringify(result).slice(0, 20_000);
        const response = await localChatStream(pending.model, [
          { role: "system", content: "Você é o InDev, um assistente de desenvolvimento local. Explique o resultado da ferramenta com precisão e não alegue ações adicionais." },
          ...thread.messages.map((message) => ({ role: message.role, content: message.content })),
          { role: "assistant", content: `Vou executar a tool '${pending.name}' autorizada pelo usuário.` },
          { role: "user", content: `A tool '${pending.name}' foi autorizada e retornou o resultado abaixo. Use-o para responder ao pedido anterior.\n\n${resultContext}` },
        ]);
        for await (const event of completionEvents(response)) {
          if (event.type !== "delta") continue;
          answer += event.text;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        appendAssistantMessage(thread, answer || `A tool '${pending.name}' foi concluída.`);
        controller.enqueue(encoder.encode("data: {\"type\":\"done\"}\n\n"));
      } catch (error) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "A tool local falhou." })}\n\n`));
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
