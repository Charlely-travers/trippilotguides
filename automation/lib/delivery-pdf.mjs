import { slugify } from "./publish-rules.mjs";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function deliveryFolderName(slug, token = "") {
  return `${slugify(slug)}${token ? `-${slugify(token)}` : ""}`;
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
}

function markdownBodyToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }
    if (/^###\s+/.test(trimmed)) {
      closeList();
      html.push(`<h3>${inlineMarkdown(trimmed.replace(/^###\s+/, ""))}</h3>`);
    } else if (/^##\s+/.test(trimmed)) {
      closeList();
      html.push(`<h2>${inlineMarkdown(trimmed.replace(/^##\s+/, ""))}</h2>`);
    } else if (/^#\s+/.test(trimmed)) {
      closeList();
      html.push(`<h1>${inlineMarkdown(trimmed.replace(/^#\s+/, ""))}</h1>`);
    } else if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(trimmed.replace(/^[-*]\s+/, ""))}</li>`);
    } else {
      closeList();
      html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
    }
  }
  closeList();
  return html.join("\n");
}

export function markdownToDeliveryHtml({ title, markdown }) {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4; margin: 18mm; }
      body { font-family: Arial, sans-serif; color: #0f172a; line-height: 1.55; }
      h1 { font-size: 28px; margin: 0 0 18px; }
      h2 { font-size: 20px; margin: 28px 0 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; }
      h3 { font-size: 16px; margin: 18px 0 8px; }
      p, li { font-size: 12px; }
      li { margin-bottom: 5px; }
      a { color: #2563eb; }
      .brand { font-size: 11px; color: #64748b; margin-bottom: 20px; }
      .footer { margin-top: 36px; border-top: 1px solid #e2e8f0; padding-top: 12px; color: #64748b; font-size: 10px; }
    </style>
  </head>
  <body>
    <div class="brand">TripPilot Guides</div>
    ${markdownBodyToHtml(markdown)}
    <div class="footer">Guide numerique TripPilot Guides. Verifiez toujours les prix, horaires et conditions avant votre depart.</div>
  </body>
</html>`;
}
