import { validateExecution } from "@/lib/execution-policy";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const result = validateExecution({
    command: Array.isArray(body.command) ? body.command.filter((item): item is string => typeof item === "string") : [],
    cwd: typeof body.cwd === "string" ? body.cwd : "",
    network: body.network === true,
  });
  return Response.json({ execution: { status: "blocked", ...result } }, { status: 409 });
}
