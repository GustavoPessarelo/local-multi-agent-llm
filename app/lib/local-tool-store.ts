export type PendingLocalTool = { id: string; threadId: string; model: string; name: string; arguments: Record<string, unknown>; createdAt: number };
const pending = new Map<string, PendingLocalTool>();

export function createPendingLocalTool(input: Omit<PendingLocalTool, "id" | "createdAt">) {
  const entry = { ...input, id: crypto.randomUUID(), createdAt: Date.now() };
  pending.set(entry.id, entry);
  return entry;
}

export function consumePendingLocalTool(id: string, threadId: string) {
  const entry = pending.get(id);
  if (!entry || entry.threadId !== threadId) return undefined;
  pending.delete(id);
  return entry;
}
