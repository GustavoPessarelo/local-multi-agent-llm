import { readdir } from "node:fs/promises";
import Ajv from "ajv";

const builtinDirectory = new URL("./builtin/", import.meta.url);
const registeredTools = new Map();
const schemaValidator = new Ajv({ allErrors: true, strict: false });

function validateTool(tool, source) {
  if (!tool || typeof tool !== "object") throw new Error(`Tool inválida em ${source}.`);
  if (tool.spec?.type !== "function") throw new Error(`A tool de ${source} precisa usar spec.type=function.`);
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(tool.spec?.name || "")) throw new Error(`Nome de tool inválido em ${source}.`);
  if (typeof tool.spec.description !== "string" || !tool.spec.description.trim()) throw new Error(`Descrição ausente em ${source}.`);
  if (!tool.spec.inputSchema || typeof tool.spec.inputSchema !== "object") throw new Error(`inputSchema ausente em ${source}.`);
  if (typeof tool.execute !== "function") throw new Error(`Executor ausente em ${source}.`);
  if (tool.preview !== undefined && typeof tool.preview !== "function") throw new Error(`Preview inválido em ${source}.`);
}

async function discoverBuiltinTools() {
  const files = (await readdir(builtinDirectory)).filter((file) => file.endsWith(".mjs")).sort();
  for (const file of files) {
    const loaded = await import(new URL(file, builtinDirectory));
    validateTool(loaded.tool, file);
    const name = loaded.tool.spec.name;
    if (registeredTools.has(name)) throw new Error(`Tool duplicada: ${name}.`);
    const validateArguments = schemaValidator.compile(loaded.tool.spec.inputSchema);
    registeredTools.set(name, { tool: loaded.tool, validateArguments });
  }
}

await discoverBuiltinTools();

function requireTool(name) {
  const registered = registeredTools.get(name);
  if (!registered) throw new Error(`Tool não cadastrada: ${name}.`);
  return registered;
}

function checkedArguments(name, args) {
  const registered = requireTool(name);
  const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  if (!registered.validateArguments(input)) {
    const detail = registered.validateArguments.errors
      ?.map((error) => `${error.instancePath || "parâmetros"} ${error.message || "inválido"}`)
      .join("; ");
    throw new Error(`Parâmetros inválidos para ${name}: ${detail || "verifique os campos informados"}.`);
  }
  return { tool: registered.tool, input };
}

export function toolCatalog() {
  return [...registeredTools.values()].map(({ tool }) => ({
    spec: tool.spec,
    approval: tool.approval || { required: false },
  }));
}

export async function previewTool(name, args, context) {
  const { tool, input } = checkedArguments(name, args);
  if (tool.preview) {
    const preview = await tool.preview(input, context);
    return {
      approvalRequired: Boolean(tool.approval?.required),
      title: typeof preview?.title === "string" ? preview.title : tool.approval?.title || "Confirmar execução",
      summary: typeof preview?.summary === "string" ? preview.summary : `Executar a tool ${name}.`,
      details: Array.isArray(preview?.details) ? preview.details.map(String) : [],
    };
  }
  return {
    approvalRequired: Boolean(tool.approval?.required),
    title: tool.approval?.title || "Confirmar execução",
    summary: tool.approval?.summary || `Executar a tool ${name}.`,
    details: [],
  };
}

export async function executeTool(name, args, context) {
  const { tool, input } = checkedArguments(name, args);
  return tool.execute(input, context);
}

export function toolRequiresApproval(name) {
  return Boolean(requireTool(name).tool.approval?.required);
}

export function assertToolRegistry() {
  if (!registeredTools.size) throw new Error("Nenhuma tool foi cadastrada.");
  return registeredTools.size;
}
