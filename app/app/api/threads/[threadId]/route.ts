import { getThread } from "@/lib/agent-store";

export async function GET(_: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  const thread = getThread(threadId);
  return thread ? Response.json({ thread }) : Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
}
