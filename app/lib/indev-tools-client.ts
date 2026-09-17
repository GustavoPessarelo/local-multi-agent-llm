export type DynamicToolSpec = {
  type: "function";
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  deferLoading?: boolean;
};

export type ToolInvocation = {
  tool: string;
  arguments: Record<string, unknown>;
  threadId: string;
  cwd: string;
};

export type ToolPreview = {
  approvalRequired: boolean;
  approvalToken?: string;
  title: string;
  summary: string;
  details: string[];
};

export type ToolExecutionResult = {
  ok?: boolean;
  outputPath?: string;
  message?: string;
  [key: string]: unknown;
};

const TOOL_SERVER = "http://127.0.0.1:4502";

async function toolRequest<T>(path: string, body?: unknown) {
  const response = await fetch(`${TOOL_SERVER}${path}`, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "A tool local falhou.");
  return data as T;
}

export async function loadInDevToolCatalog() {
  return toolRequest<{ tools: Array<{ spec: DynamicToolSpec; approval: { required: boolean; title?: string } }> }>("/tools/catalog");
}

export async function previewInDevTool(invocation: ToolInvocation) {
  return toolRequest<ToolPreview>("/tools/preview", invocation);
}

export async function executeInDevTool(invocation: ToolInvocation, approvalToken?: string) {
  return toolRequest<ToolExecutionResult>("/tools/execute", { ...invocation, approvalToken });
}
