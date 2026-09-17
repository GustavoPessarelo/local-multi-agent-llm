import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";

import { createMassivaPlan, executeMassiva } from "../tools/builtin/analise-massiva.mjs";
import { assertToolRegistry, previewTool, toolCatalog, toolRequiresApproval } from "../tools/registry.mjs";

test("o registro descobre e valida a tool de análise massiva", () => {
  assert.ok(assertToolRegistry() >= 1);
  const registered = toolCatalog().find((entry) => entry.spec.name === "analise_massiva_llm");
  assert.ok(registered);
  assert.equal(registered.approval.required, true);
  assert.equal(toolRequiresApproval("analise_massiva_llm"), true);
  assert.deepEqual(registered.spec.inputSchema.required, ["arquivo", "coluna_texto", "colunas_saida", "contexto"]);
});

test("o registro rejeita argumentos fora do schema antes de executar a tool", async () => {
  await assert.rejects(
    previewTool("analise_massiva_llm", { arquivo: "/tmp/incompleto.xlsx" }, { cwd: "/tmp", threadId: "chat" }),
    /Parâmetros inválidos.*coluna_texto.*colunas_saida.*contexto/,
  );
});

test("a análise massiva exige preview, preserva o original e produz Excel por chat", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "indev-massiva-"));
  try {
    const uploadDirectory = join(workspace, ".indev", "uploads", "chat-teste");
    await mkdir(uploadDirectory, { recursive: true });
    const inputPath = join(uploadDirectory, "relatos.xlsx");
    const source = new ExcelJS.Workbook();
    const sheet = source.addWorksheet("Dados");
    sheet.addRow(["Relato", "Valor"]);
    sheet.addRow(["Pagamento duplicado", 100]);
    sheet.addRow(["Compra normal", 50]);
    sheet.addRow(["", 10]);
    await source.xlsx.writeFile(inputPath);

    const args = {
      arquivo: inputPath,
      aba: "Dados",
      coluna_texto: "Relato",
      colunas_saida: ["Risco", "Justificativa"],
      contexto: "Marque duplicidades como alto risco.",
      limite: 0,
      concorrencia: 2,
    };
    const context = { cwd: workspace, threadId: "chat/teste" };
    const preview = await createMassivaPlan(args, context);
    assert.equal(preview.approvalRequired, true);
    assert.match(preview.summary, /2 linhas/);
    assert.ok(preview.details.some((detail) => detail.includes("2 chamadas")));

    const result = await executeMassiva(args, context, {
      classifier: async ({ text }) => ({
        values: {
          Risco: text.includes("duplicado") ? "Alto" : "Baixo",
          Justificativa: text.includes("duplicado") ? "Possível duplicidade" : "Sem indício",
        },
        usage: { input_tokens: 10, output_tokens: 4 },
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.linhasProcessadas, 2);
    assert.equal(result.erros, 0);
    assert.match(result.outputPath, /entregaveis[\\/]chat_teste[\\/].*\.xlsx$/);
    assert.deepEqual(result.uso, { inputTokens: 20, outputTokens: 8 });

    const original = new ExcelJS.Workbook();
    await original.xlsx.readFile(inputPath);
    assert.equal(original.getWorksheet("Dados").getRow(1).getCell(3).value, null);

    const output = new ExcelJS.Workbook();
    await output.xlsx.readFile(result.outputPath);
    const outputSheet = output.getWorksheet("Dados");
    assert.equal(outputSheet.getRow(1).getCell(3).value, "Risco");
    assert.equal(outputSheet.getRow(1).getCell(4).value, "Justificativa");
    assert.equal(outputSheet.getRow(2).getCell(3).value, "Alto");
    assert.equal(outputSheet.getRow(3).getCell(3).value, "Baixo");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
