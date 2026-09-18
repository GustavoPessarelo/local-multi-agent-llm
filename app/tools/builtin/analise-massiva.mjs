import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import ExcelJS from "exceljs";

export const MAX_MASSIVA_ROWS = 8_000;
export const DEFAULT_MASSIVA_MODEL = "google/gemma-3-4b";
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 10;
const MAX_WORKBOOK_BYTES = 100 * 1024 * 1024;

export const tool = {
  spec: {
    type: "function",
    name: "analise_massiva_llm",
    description: "Classifica ou extrai informações de cada linha textual de uma planilha Excel .xlsx, cria colunas definidas pelo usuário e salva uma nova planilha como entrega do chat. Use quando o usuário pedir para analisar, classificar, categorizar ou validar muitos registros. A interface sempre exige aprovação explícita porque ocorre uma chamada de modelo por linha.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        arquivo: { type: "string", description: "Caminho absoluto do arquivo .xlsx enviado ou mencionado no chat." },
        aba: { type: "string", description: "Nome da aba. Se omitido, usa a primeira aba." },
        coluna_texto: { type: "string", description: "Cabeçalho da coluna que contém o texto a analisar." },
        colunas_saida: { type: "array", minItems: 1, maxItems: 12, items: { type: "string" }, description: "Cabeçalhos das colunas que o modelo deve preencher." },
        contexto: { type: "string", minLength: 3, description: "Critério, política ou instrução usada para analisar cada linha." },
        modelo: { type: "string", description: "Modelo local para cada linha. O padrão é google/gemma-3-4b." },
        limite: { type: "integer", minimum: 0, maximum: 8000, description: "Quantidade máxima de linhas. Zero ou ausência significa todas, até 8.000." },
        concorrencia: { type: "integer", minimum: 1, maximum: 10, description: "Chamadas simultâneas. Padrão 4; máximo 10." },
      },
      required: ["arquivo", "coluna_texto", "colunas_saida", "contexto"],
    },
    deferLoading: false,
  },
  approval: {
    required: true,
    title: "Confirmar análise massiva",
  },
  preview: createMassivaPlan,
  execute: executeMassiva,
};

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function integerInRange(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function uniqueOutputColumns(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map(cleanString).filter((column) => {
    const key = column.toLocaleLowerCase("pt-BR");
    if (!column || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeThreadName(value) {
  return cleanString(value).replace(/[^a-zA-Z0-9._-]/g, "_") || "sem-chat";
}

async function ensureWorkspacePath(filePath, workspace) {
  const workspaceInput = cleanString(workspace);
  const candidateInput = cleanString(filePath);
  if (!workspaceInput) throw new Error("A área de trabalho do chat não foi informada.");
  if (!candidateInput || !isAbsolute(candidateInput)) throw new Error("Informe o caminho absoluto do arquivo Excel.");
  const root = await realpath(resolve(workspaceInput));
  const candidate = await realpath(resolve(candidateInput));
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) throw new Error("O arquivo precisa estar dentro da área de trabalho deste chat.");
  if (extname(candidate).toLowerCase() !== ".xlsx") throw new Error("A análise massiva desta versão aceita arquivos .xlsx.");
  const metadata = await stat(candidate);
  if (!metadata.isFile()) throw new Error("O caminho informado não é um arquivo Excel.");
  if (metadata.size > MAX_WORKBOOK_BYTES) throw new Error("A planilha excede o limite de 100 MB desta versão.");
  return { root, candidate };
}

function cellText(cell) {
  if (!cell) return "";
  const text = typeof cell.text === "string" ? cell.text.trim() : "";
  if (text) return text;
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function findHeaderRow(worksheet) {
  const lastCandidate = Math.min(Math.max(worksheet.rowCount, 1), 20);
  for (let rowNumber = 1; rowNumber <= lastCandidate; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values = [];
    for (let column = 1; column <= Math.max(row.cellCount, worksheet.columnCount); column += 1) values.push(cellText(row.getCell(column)));
    if (values.filter(Boolean).length >= 1) return { rowNumber, values };
  }
  throw new Error("Não encontrei uma linha de cabeçalho na planilha.");
}

function findColumnIndex(headers, requested) {
  const target = cleanString(requested).toLocaleLowerCase("pt-BR");
  const index = headers.findIndex((header) => header.toLocaleLowerCase("pt-BR") === target);
  if (index < 0) throw new Error(`A coluna '${requested}' não existe. Disponíveis: ${headers.filter(Boolean).join(", ")}.`);
  return index + 1;
}

function resolveOutputColumnIndexes(worksheet, headerRowNumber, headers, outputColumns) {
  const indexes = new Map();
  let nextColumn = Math.max(headers.length, worksheet.columnCount) + 1;
  for (const column of outputColumns) {
    const existing = headers.findIndex((header) => header.toLocaleLowerCase("pt-BR") === column.toLocaleLowerCase("pt-BR"));
    const index = existing >= 0 ? existing + 1 : nextColumn++;
    worksheet.getRow(headerRowNumber).getCell(index).value = column;
    indexes.set(column, index);
  }
  return indexes;
}

async function inspectWorkbook(args, context) {
  const { root, candidate } = await ensureWorkspacePath(args.arquivo, context.cwd);
  const outputColumns = uniqueOutputColumns(args.colunas_saida);
  if (!outputColumns.length) throw new Error("Informe ao menos uma coluna de saída.");
  const criteria = cleanString(args.contexto);
  if (!criteria) throw new Error("Informe o critério da análise massiva.");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(candidate);
  const requestedSheet = cleanString(args.aba);
  const worksheet = requestedSheet ? workbook.getWorksheet(requestedSheet) : workbook.worksheets[0];
  if (!worksheet) throw new Error(requestedSheet ? `A aba '${requestedSheet}' não existe.` : "A planilha não possui abas.");

  const { rowNumber: headerRowNumber, values: headers } = findHeaderRow(worksheet);
  const textColumnIndex = findColumnIndex(headers, args.coluna_texto);
  const candidateRows = [];
  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const text = cellText(worksheet.getRow(rowNumber).getCell(textColumnIndex));
    if (text) candidateRows.push({ rowNumber, text });
  }
  const requestedLimit = integerInRange(args.limite, 0, 0, MAX_MASSIVA_ROWS);
  const selectedRows = requestedLimit > 0 ? candidateRows.slice(0, requestedLimit) : candidateRows;
  if (selectedRows.length > MAX_MASSIVA_ROWS) throw new Error(`A planilha possui ${selectedRows.length} linhas válidas; o teto é ${MAX_MASSIVA_ROWS}. Use limite ou filtre a planilha.`);
  if (!selectedRows.length) throw new Error(`A coluna '${args.coluna_texto}' não possui linhas com texto para analisar.`);

  return {
    root,
    candidate,
    workbook,
    worksheet,
    headerRowNumber,
    headers,
    selectedRows,
    totalRows: candidateRows.length,
    outputColumns,
    criteria,
    model: cleanString(args.modelo) || process.env.INDEV_MASSIVA_MODEL || process.env.INDEV_DEFAULT_MODEL || DEFAULT_MASSIVA_MODEL,
    concurrency: integerInRange(args.concorrencia, DEFAULT_CONCURRENCY, 1, MAX_CONCURRENCY),
  };
}

export async function createMassivaPlan(args, context) {
  const inspected = await inspectWorkbook(args, context);
  return {
    approvalRequired: true,
    title: "Confirmar análise massiva",
    summary: `${inspected.selectedRows.length} linhas da aba '${inspected.worksheet.name}' serão analisadas com ${inspected.model}.`,
    details: [
      `Arquivo: ${basename(inspected.candidate)}`,
      `Coluna de entrada: ${cleanString(args.coluna_texto)}`,
      `Colunas de saída: ${inspected.outputColumns.join(", ")}`,
      `Dados enviados: conteúdo da coluna '${cleanString(args.coluna_texto)}' para o modelo local`,
      `Processamento: aproximadamente ${inspected.selectedRows.length} chamadas locais de modelo`,
      `Paralelismo: ${inspected.concurrency} por vez`,
    ],
  };
}

function structuredOutputSchema(outputColumns) {
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(outputColumns.map((column) => [column, { type: "string" }])),
    required: outputColumns,
  };
}

async function withRetries(operation, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || error?.response?.status || 0);
      if (attempt === attempts - 1 || (status && status !== 408 && status !== 409 && status !== 429 && status < 500)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 500 * (2 ** attempt)));
    }
  }
  throw lastError;
}

function localModelUrl() {
  const raw = String(process.env.INDEV_LOCAL_BASE_URL || "http://127.0.0.1:1234/v1").replace(/\/+$/, "");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("A análise massiva aceita somente um servidor de modelos em localhost.");
  return url.toString().replace(/\/$/, "");
}

function parseModelJson(content) {
  const source = String(content || "").trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("O modelo local não retornou JSON estruturado.");
  return JSON.parse(source.slice(start, end + 1));
}

function createLocalClassifier({ model, outputColumns, criteria }) {
  const schema = structuredOutputSchema(outputColumns);
  return async ({ text }) => {
    const response = await withRetries(async () => {
      const result = await fetch(`${localModelUrl()}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: {
            type: "json_schema",
            json_schema: { name: "resultado_analise_massiva", strict: true, schema },
          },
          messages: [
            { role: "system", content: `Você é um classificador de dados preciso. Aplique o critério abaixo ao registro recebido. Não invente fatos. Responda somente com um objeto JSON válido. Critério:\n${criteria}\nSchema JSON esperado:\n${JSON.stringify(schema)}` },
            { role: "user", content: text },
          ],
        }),
      });
      if (!result.ok) {
        const error = new Error(`O modelo local respondeu ${result.status}: ${(await result.text()).slice(0, 300)}`);
        error.status = result.status;
        throw error;
      }
      return result.json();
    });
    const parsed = parseModelJson(response.choices?.[0]?.message?.content);
    return {
      values: Object.fromEntries(outputColumns.map((column) => [column, String(parsed[column] ?? "")])),
      usage: response.usage ? { input_tokens: response.usage.prompt_tokens || 0, output_tokens: response.usage.completion_tokens || 0 } : null,
    };
  };
}

async function classifyInParallel(rows, concurrency, classifier, onProgress) {
  const results = new Array(rows.length);
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= rows.length) return;
      const row = rows[index];
      try {
        results[index] = { ok: true, ...(await classifier({ text: row.text, rowNumber: row.rowNumber })) };
      } catch (error) {
        results[index] = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      completed += 1;
      if (onProgress) await onProgress({ current: completed, total: rows.length, message: `Análise massiva: ${completed} de ${rows.length}` });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));
  return results;
}

export async function executeMassiva(args, context, dependencies = {}) {
  const inspected = await inspectWorkbook(args, context);
  const classifier = dependencies.classifier || createLocalClassifier({
    model: inspected.model,
    outputColumns: inspected.outputColumns,
    criteria: inspected.criteria,
  });

  const results = await classifyInParallel(inspected.selectedRows, inspected.concurrency, classifier, context.onProgress);
  const outputIndexes = resolveOutputColumnIndexes(inspected.worksheet, inspected.headerRowNumber, inspected.headers, inspected.outputColumns);
  let errors = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  results.forEach((result, index) => {
    const row = inspected.worksheet.getRow(inspected.selectedRows[index].rowNumber);
    if (!result.ok) errors += 1;
    for (const column of inspected.outputColumns) {
      row.getCell(outputIndexes.get(column)).value = result.ok ? result.values[column] : `[ERRO] ${result.error}`.slice(0, 300);
    }
    inputTokens += Number(result.usage?.input_tokens || 0);
    outputTokens += Number(result.usage?.output_tokens || 0);
  });

  const outputDirectory = join(inspected.root, "entregaveis", safeThreadName(context.threadId));
  await mkdir(outputDirectory, { recursive: true });
  const stem = basename(inspected.candidate, extname(inspected.candidate)).replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = join(outputDirectory, `${stem}-analise-massiva-${timestamp}.xlsx`);
  await inspected.workbook.xlsx.writeFile(outputPath);

  return {
    ok: true,
    tool: tool.spec.name,
    outputPath,
    linhasProcessadas: inspected.selectedRows.length,
    totalLinhasValidas: inspected.totalRows,
    colunasCriadas: inspected.outputColumns,
    modelo: inspected.model,
    erros: errors,
    uso: { inputTokens, outputTokens },
    message: `Análise massiva concluída em ${inspected.selectedRows.length} linhas. O arquivo final está em ${outputPath}.`,
  };
}
