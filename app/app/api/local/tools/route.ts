import { requestToolService } from "@/lib/tool-service";

export async function GET() {
  try { return Response.json(await requestToolService("/tools/catalog")); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Serviço de tools indisponível." }, { status: 503 }); }
}
