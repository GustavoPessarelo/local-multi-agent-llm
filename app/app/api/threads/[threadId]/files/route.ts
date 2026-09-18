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
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Selecione um arquivo." }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return Response.json({ error: "O limite atual é 10 MB por arquivo." }, { status: 413 });
  const stored = addThreadFile(thread, { name: file.name, size: file.size, type: file.type || "application/octet-stream", openaiFileId: `local_${crypto.randomUUID()}` });
  return Response.json({ file: stored, files: thread.files }, { status: 201 });
}
