import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import MarkdownIt from "markdown-it";
import { loadDocumentProfile } from "../../document-profiles/registry.mjs";

const MAX_MARKDOWN_CHARACTERS = 500_000;

export const tool = {
  spec: {
    type: "function",
    name: "renderizar_documento",
    description: "Renderiza o conteúdo final de uma documentação em Markdown usando um perfil visual institucional cadastrado, cria um HTML standalone e o publica como entrega do chat. Use depois de escrever o conteúdo quando o usuário pedir um documento padronizado; não gere CSS nem redesenhe a marca no Markdown.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        perfil: { type: "string", pattern: "^[a-z][a-z0-9-]{1,31}$", description: "Perfil visual cadastrado. Para o padrão solicitado, use itau." },
        formato: { type: "string", enum: ["html"], description: "Formato de saída desta versão. Use html." },
        titulo: { type: "string", minLength: 3, maxLength: 180, description: "Título principal do documento." },
        subtitulo: { type: "string", maxLength: 300, description: "Subtítulo executivo opcional." },
        conteudo_markdown: { type: "string", minLength: 1, maxLength: MAX_MARKDOWN_CHARACTERS, description: "Conteúdo semântico completo em Markdown. Não inclua HTML, CSS, capa, cabeçalho ou rodapé." },
        classificacao: { type: "string", enum: ["Documento interno", "Confidencial", "Uso restrito", "Público"], description: "Classificação exibida no cabeçalho. Padrão: Documento interno." },
        data_documento: { type: "string", maxLength: 40, description: "Data ou período exibido na capa. Se omitido, usa a data atual." },
        nome_arquivo: { type: "string", maxLength: 80, description: "Nome base opcional, sem extensão." },
      },
      required: ["perfil", "formato", "titulo", "conteudo_markdown"],
    },
    deferLoading: false,
  },
  approval: { required: false },
  execute: executeDocumentRenderer,
};

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeThreadName(value) {
  return cleanString(value).replace(/[^a-zA-Z0-9._-]/g, "_") || "sem-chat";
}

function safeFileStem(value) {
  return cleanString(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "documento";
}

function stripOuterMarkdownFence(markdown) {
  const content = cleanString(markdown);
  const match = content.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  return match ? match[1].trim() : content;
}

function createMarkdownRenderer() {
  const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
  markdown.validateLink = (url) => /^(https?:|mailto:|#)/i.test(url);
  markdown.renderer.rules.image = (tokens, index) => {
    const alt = tokens[index].content || tokens[index].attrGet("alt") || "imagem";
    return `<span class="asset-blocked">Imagem externa omitida: ${escapeHtml(alt)}</span>`;
  };
  markdown.renderer.rules.table_open = () => '<div class="table-wrap"><table>';
  markdown.renderer.rules.table_close = () => "</table></div>";
  return markdown;
}

function formatCurrentDate() {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date());
}

function createStandaloneHtml({ profile, title, subtitle, classification, documentDate, markdownHtml }) {
  const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(profile.logoSvg, "utf8").toString("base64")}`;
  const profileLabel = escapeHtml(profile.displayName);
  const subtitleBlock = subtitle ? `<p class="hero-subtitle">${escapeHtml(subtitle)}</p>` : "";
  return `<!DOCTYPE html>
<html lang="pt-BR" data-document-profile="${escapeHtml(profile.id)}" data-profile-version="${escapeHtml(profile.version || "1.0.0")}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(title)}</title>
  <style>${profile.css}</style>
</head>
<body>
  <!-- Logo source: ${escapeHtml(profile.logo?.source || "asset local")} -->
  <a class="skip-link" href="#conteudo">Ir para o conteúdo</a>
  <header class="document-header">
    <span class="brand-logo-wrap"><img class="brand-logo" src="${logoDataUri}" alt="${profileLabel}"></span>
    <span class="header-copy">
      <span class="header-eyebrow">${profileLabel} · documentação institucional</span>
      <span class="header-title">${escapeHtml(title)}</span>
    </span>
    <span class="classification">${escapeHtml(classification)}</span>
  </header>
  <main class="document-shell" id="conteudo">
    <section class="document-hero" aria-labelledby="titulo-documento">
      <p class="hero-kicker">Documento institucional</p>
      <h1 id="titulo-documento">${escapeHtml(title)}</h1>
      ${subtitleBlock}
      <div class="hero-meta"><span>${escapeHtml(documentDate)}</span><span>Perfil ${profileLabel} · v${escapeHtml(profile.version || "1.0.0")}</span></div>
    </section>
    <article class="document-body">${markdownHtml}</article>
    <footer class="document-footer">
      <span class="footer-brand">${profileLabel}</span>
      <span>${escapeHtml(classification)}</span>
      <span class="footer-note">Gerado pelo InDev · ${escapeHtml(documentDate)}</span>
    </footer>
  </main>
</body>
</html>`;
}

export async function executeDocumentRenderer(args, context) {
  const workspaceInput = cleanString(context?.cwd);
  if (!workspaceInput) throw new Error("A área de trabalho do chat não foi informada.");
  const workspace = await realpath(workspaceInput);
  const profile = await loadDocumentProfile(args.perfil);
  if (args.formato !== "html") throw new Error("Esta versão do renderizador produz HTML. O suporte a PDF será adicionado pelo mesmo perfil visual.");

  const title = cleanString(args.titulo);
  const subtitle = cleanString(args.subtitulo);
  const classification = cleanString(args.classificacao) || "Documento interno";
  const documentDate = cleanString(args.data_documento) || formatCurrentDate();
  const markdownContent = stripOuterMarkdownFence(args.conteudo_markdown);
  if (!markdownContent) throw new Error("O conteúdo Markdown do documento está vazio.");

  const markdownHtml = createMarkdownRenderer().render(markdownContent);
  const html = createStandaloneHtml({ profile, title, subtitle, classification, documentDate, markdownHtml });
  const outputDirectory = join(workspace, "entregaveis", safeThreadName(context.threadId));
  await mkdir(outputDirectory, { recursive: true });
  const stem = safeFileStem(args.nome_arquivo || title);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = join(outputDirectory, `${stem}-${profile.id}-${timestamp}.html`);
  await writeFile(outputPath, html, "utf8");

  return {
    ok: true,
    tool: tool.spec.name,
    outputPath,
    perfil: profile.id,
    perfilVersao: profile.version || "1.0.0",
    formato: "html",
    classificacao: classification,
    message: `Documento '${title}' renderizado com o perfil ${profile.displayName}. O HTML final está em ${outputPath}.`,
  };
}
