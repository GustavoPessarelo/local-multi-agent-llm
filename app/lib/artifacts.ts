export type ArtifactKind = "generated" | "modified" | "worked" | "uploaded" | "referenced";
export type ArtifactRole = "output" | "input" | "worker";

export type ArtifactCandidate = {
  label?: string;
  path: string;
};

const ARTIFACT_ROLE_PRIORITY: Record<ArtifactRole, number> = {
  worker: 0,
  input: 1,
  output: 2,
};

export function mergeArtifactRole(current: ArtifactRole, incoming: ArtifactRole) {
  return ARTIFACT_ROLE_PRIORITY[incoming] > ARTIFACT_ROLE_PRIORITY[current] ? incoming : current;
}

const OUTPUT_EXTENSIONS = new Set([
  ".html", ".htm", ".pdf", ".zip", ".xlsx", ".xls", ".csv", ".tsv",
  ".docx", ".pptx", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".txt", ".md", ".json", ".xml", ".yaml", ".yml",
]);

const DELIVERABLE_EXTENSIONS = new Set([
  ".html", ".htm", ".pdf", ".zip", ".xlsx", ".xls", ".csv", ".tsv",
  ".docx", ".pptx", ".png", ".jpg", ".jpeg", ".gif", ".webp",
]);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html;charset=utf-8",
  ".htm": "text/html;charset=utf-8",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv;charset=utf-8",
  ".tsv": "text/tab-separated-values;charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain;charset=utf-8",
  ".md": "text/markdown;charset=utf-8",
  ".json": "application/json;charset=utf-8",
  ".xml": "application/xml;charset=utf-8",
  ".yaml": "text/yaml;charset=utf-8",
  ".yml": "text/yaml;charset=utf-8",
};

const LOCAL_MARKDOWN_LINK = /\[([^\]]+)\]\(([^)\n]+)\)/g;
const LOCAL_RAW_PATH = /(?:[A-Za-z]:[\\/]|\/)(?:[^\s<>"'`|]+[\\/])*[^\s<>"'`|]+\.(?:html?|pdf|zip|xlsx?|csv|tsv|docx|pptx|png|jpe?g|gif|webp|svg|txt|md|json|xml|ya?ml)/gi;

export function unescapeAgentPath(value: string) {
  return value.trim().replace(/^<|>$/g, "").replace(/\\([\\_()[\]# -])/g, "$1").replace(/[.,;:!?]+$/g, "");
}

export function isAbsoluteAgentPath(path: string) {
  return /^(?:[A-Za-z]:[\\/]|\/)/.test(path) && !/^\/\//.test(path);
}

export function artifactFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || "arquivo";
}

export function artifactExtension(path: string) {
  const name = artifactFileName(path);
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

export function artifactMimeType(path: string) {
  return MIME_TYPES[artifactExtension(path)] || "application/octet-stream";
}

export function isOutputArtifact(path: string) {
  return OUTPUT_EXTENSIONS.has(artifactExtension(path));
}

export function isDeliverableArtifact(path: string) {
  return DELIVERABLE_EXTENSIONS.has(artifactExtension(path));
}

export function artifactPreviewKind(path: string): "html" | "image" | "pdf" | "text" | null {
  const extension = artifactExtension(path);
  if (extension === ".html" || extension === ".htm") return "html";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extension)) return "image";
  if (extension === ".pdf") return "pdf";
  if ([".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml"].includes(extension)) return "text";
  return null;
}

function normalizedPath(path: string) {
  const slashPath = unescapeAgentPath(path).replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:\//.test(slashPath) ? slashPath.toLowerCase() : slashPath;
}

export function artifactPathKey(path: string) {
  return normalizedPath(path);
}

export function isPathInsideWorkspace(path: string, workspace: string) {
  const candidate = normalizedPath(path);
  const root = normalizedPath(workspace);
  return Boolean(root) && (candidate === root || candidate.startsWith(`${root}/`));
}

export function shouldIgnoreArtifactPath(path: string) {
  const normalized = normalizedPath(path);
  return [
    "/.git/", "/node_modules/", "/.next/", "/dist/", "/.wrangler/",
    "/.indev/codex-home/", "/.indev/shell_snapshots/",
  ].some((part) => normalized.includes(part));
}

export function extractArtifactCandidates(text: string) {
  const candidates = new Map<string, ArtifactCandidate>();
  for (const match of text.matchAll(LOCAL_MARKDOWN_LINK)) {
    const path = unescapeAgentPath(match[2]);
    if (isAbsoluteAgentPath(path)) candidates.set(artifactPathKey(path), { label: match[1].trim(), path });
  }
  for (const match of text.matchAll(LOCAL_RAW_PATH)) {
    const path = unescapeAgentPath(match[0]);
    const key = artifactPathKey(path);
    if (isAbsoluteAgentPath(path) && !candidates.has(key)) candidates.set(key, { path });
  }
  return [...candidates.values()];
}

export function messageWithoutLocalPaths(text: string) {
  const linkedPaths = new Set<string>();
  const withoutLinks = text.replace(LOCAL_MARKDOWN_LINK, (full, label: string, rawPath: string) => {
    const path = unescapeAgentPath(rawPath);
    if (!isAbsoluteAgentPath(path)) return full;
    linkedPaths.add(artifactPathKey(path));
    return `📄 ${label.trim()} — disponível em Arquivos`;
  });
  return withoutLinks.replace(LOCAL_RAW_PATH, (rawPath) => {
    const path = unescapeAgentPath(rawPath);
    return linkedPaths.has(artifactPathKey(path)) ? "" : `${artifactFileName(path)} — disponível em Arquivos`;
  }).replace(/\n{3,}/g, "\n\n").trim();
}
