import OpenAI from "openai";
import { appendAssistantMessage, appendUserMessage, getThread } from "@/lib/agent-store";

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  const thread = getThread(threadId);
  if (!thread) return Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.content !== "string" || !body.content.trim()) {
    return Response.json({ error: "Uma mensagem é obrigatória." }, { status: 400 });
  }
  appendUserMessage(thread, body.content.trim());
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({
      error: "A chave da OpenAI ainda não foi configurada. Adicione OPENAI_API_KEY ao arquivo .env.local.",
      thread,
    }, { status: 503 });
  }
  const client = new OpenAI({ apiKey });
  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      store: false,
      instructions: "Você é o InDev, um assistente de desenvolvimento. Seja objetivo, explique o plano antes de mudanças relevantes e não alegue executar ferramentas que não estão conectadas.",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: thread.messages.map((message) => `${message.role === "user" ? "Usuário" : "InDev"}: ${message.content}`).join("\n\n") },
          ...thread.files.map((file) => ({ type: "input_file" as const, file_id: file.openaiFileId })),
        ],
      }],
    });
    appendAssistantMessage(thread, response.output_text || "Não recebi texto de resposta do modelo.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível comunicar com a OpenAI.";
    return Response.json({ error: message, thread }, { status: 502 });
  }
  return Response.json({ thread });
}
