import { createThread, listThreads } from "@/lib/agent-store";

export async function GET() {
  return Response.json({ threads: listThreads() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const thread = createThread(typeof body.title === "string" ? body.title : undefined);
  return Response.json({ thread }, { status: 201 });
}
