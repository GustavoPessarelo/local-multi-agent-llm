import { defaultLocalModel, listLocalModels } from "@/lib/local-model";

export async function GET() {
  try {
    const models = await listLocalModels();
    return Response.json({
      models: models.map((entry) => ({ id: entry.id, model: entry.id, displayName: entry.id })),
      defaultModel: defaultLocalModel(models),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível listar os modelos locais.";
    return Response.json({ error: message }, { status: 503 });
  }
}
