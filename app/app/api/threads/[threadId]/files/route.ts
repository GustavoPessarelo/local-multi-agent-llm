import OpenAI from "openai";
import { addThreadFile, getThread } from "@/lib/agent-store";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function GET(_: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  const thread = getThread(threadId);
  return thread ? Response.json({ files: thread.files }) : Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  const thread = getThread(threadId);
  if (!thread) return Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "A chave da OpenAI não está configurada." }, { status: 503 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Selecione um arquivo." }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return Response.json({ error: "O limite atual é 10 MB por arquivo." }, { status: 413 });
  try {
    const client = new OpenAI({ apiKey });
    const uploaded = await client.files.create({ file, purpose: "user_data" });
    const stored = addThreadFile(thread, { name: file.name, size: file.size, type: file.type || "application/octet-stream", openaiFileId: uploaded.id });
    return Response.json({ file: stored, files: thread.files }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível enviar o arquivo.";
    return Response.json({ error: message }, { status: 502 });
  }
}
