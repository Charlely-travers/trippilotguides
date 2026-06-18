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

/* ---------------- Nettoyage du markdown avant rendu ---------------- */

/** Retire le frontmatter YAML en tête de fichier. */
function stripFrontmatter(md) {
  return String(md || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/** Titres de sections internes (production) à NE PAS livrer au client. */
const INTERNAL_SECTION_RE =
  /^(structure du pdf|pages?\s+pr[ée]vues?|[ée]l[ée]ments?\s+visuels|liens?\s+[àa]\s+v[ée]rifier|sources?)\b/i;

/**
 * Nettoie le markdown d'un guide pour le rendre "client-ready" :
 * - retire le frontmatter
 * - retire les notes internes (Source interne, Brouillon généré…)
 * - retire les marqueurs de complétude et titres de production
 * - supprime les sections internes (Structure du PDF, Pages prévues, Canva, Liens à vérifier)
 */
export function cleanGuideMarkdown(md) {
  let text = stripFrontmatter(md);
  // Marqueurs HTML
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  const lines = text.split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const titleText = heading[2].trim();
      // Saute les titres de section interne.
      if (INTERNAL_SECTION_RE.test(titleText)) {
        skipping = true;
        continue;
      }
      // Saute tous les H1 (le titre figure déjà sur la couverture).
      if (level === 1) {
        continue;
      }
      skipping = false;
    }
    if (skipping) continue;
    // Notes internes en blockquote.
    if (/^>\s*(source interne|brouillon g[ée]n[ée]r[ée])/i.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------------- Markdown -> HTML (inline + blocs) ---------------- */

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>")
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
}

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function markdownBodyToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let i = 0;
  let listType = null; // "ul" | "ol" | "check" | null

  const closeList = () => {
    if (listType === "ul" || listType === "check") html.push("</ul>");
    else if (listType === "ol") html.push("</ol>");
    listType = null;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      i++;
      continue;
    }

    // Tableau : ligne avec | suivie d'une ligne séparatrice
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      closeList();
      const header = splitTableRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      html.push('<div class="table-wrap"><table>');
      html.push(
        "<thead><tr>" +
          header.map((c) => `<th>${inlineMarkdown(c)}</th>`).join("") +
          "</tr></thead>"
      );
      html.push("<tbody>");
      for (const row of rows) {
        html.push(
          "<tr>" + row.map((c) => `<td>${inlineMarkdown(c)}</td>`).join("") + "</tr>"
        );
      }
      html.push("</tbody></table></div>");
      continue;
    }

    // Titres
    let m;
    if ((m = trimmed.match(/^###\s+(.*)$/))) {
      closeList();
      html.push(`<h3>${inlineMarkdown(m[1])}</h3>`);
      i++;
      continue;
    }
    if ((m = trimmed.match(/^##\s+(.*)$/))) {
      closeList();
      html.push(`<h2>${inlineMarkdown(m[1])}</h2>`);
      i++;
      continue;
    }
    if ((m = trimmed.match(/^#\s+(.*)$/))) {
      closeList();
      html.push(`<h1>${inlineMarkdown(m[1])}</h1>`);
      i++;
      continue;
    }

    // Séparateur
    if (/^---+$/.test(trimmed)) {
      closeList();
      html.push("<hr/>");
      i++;
      continue;
    }

    // Checklist
    if ((m = trimmed.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/))) {
      if (listType !== "check") {
        closeList();
        html.push('<ul class="checklist">');
        listType = "check";
      }
      const checked = m[1].toLowerCase() === "x";
      html.push(
        `<li class="${checked ? "checked" : ""}"><span class="box">${checked ? "✓" : ""}</span>${inlineMarkdown(m[2])}</li>`
      );
      i++;
      continue;
    }

    // Liste à puces
    if ((m = trimmed.match(/^[-*]\s+(.*)$/))) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${inlineMarkdown(m[1])}</li>`);
      i++;
      continue;
    }

    // Liste numérotée
    if ((m = trimmed.match(/^\d+[.)]\s+(.*)$/))) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${inlineMarkdown(m[1])}</li>`);
      i++;
      continue;
    }

    // Blockquote
    if ((m = trimmed.match(/^>\s?(.*)$/))) {
      closeList();
      const quoteLines = [m[1]];
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      html.push(
        `<blockquote>${quoteLines.map((q) => inlineMarkdown(q)).join("<br/>")}</blockquote>`
      );
      continue;
    }

    // Paragraphe
    closeList();
    html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
    i++;
  }
  closeList();
  return html.join("\n");
}

/* ---------------- Template PDF ---------------- */

export function markdownToDeliveryHtml({ title, destination = "", markdown, kind = "guide", coverImage = "" }) {
  const cleaned = kind === "guide" ? cleanGuideMarkdown(markdown) : stripFrontmatter(markdown);
  const body = markdownBodyToHtml(cleaned);
  const kicker = kind === "guide" ? "Guide de voyage PDF" : "Checklist de préparation";
  const dest = destination || "";
  const coverPhoto = coverImage
    ? `<div class="cover-photo" style="background-image:url('${coverImage}')"></div>`
    : "";

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4; margin: 16mm 15mm; }
      @page :first { margin: 0; }
      * { box-sizing: border-box; }
      body {
        font-family: "Helvetica Neue", Arial, sans-serif;
        color: #0f172a;
        line-height: 1.6;
        font-size: 11.5px;
        margin: 0;
      }

      /* ---------- Couverture ---------- */
      .cover {
        position: relative;
        height: 297mm;
        width: 210mm;
        background: linear-gradient(150deg, #4f46e5 0%, #6d28d9 55%, #0f766e 100%);
        color: #fff;
        padding: 30mm 22mm;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        page-break-after: always;
        overflow: hidden;
      }
      .cover-photo {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
        opacity: 0.55;
        z-index: 0;
      }
      .cover-overlay {
        position: absolute;
        inset: 0;
        background: linear-gradient(160deg, rgba(49,46,129,0.82) 0%, rgba(109,40,217,0.72) 50%, rgba(15,118,110,0.85) 100%);
        z-index: 1;
      }
      .cover-brand, .cover-center, .cover-foot { position: relative; z-index: 2; }
      .cover::before {
        content: "";
        position: absolute;
        top: -60mm; right: -40mm;
        width: 140mm; height: 140mm;
        border-radius: 50%;
        background: rgba(255,255,255,0.08);
        z-index: 1;
      }
      .cover-brand { font-size: 16px; font-weight: 800; letter-spacing: 0.5px; opacity: 0.95; }
      .cover-center { }
      .cover-kicker {
        display: inline-block;
        font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px;
        background: rgba(255,255,255,0.18); padding: 6px 16px; border-radius: 999px; margin-bottom: 18px;
      }
      .cover-title { font-size: 44px; line-height: 1.1; font-weight: 800; margin: 0 0 14px; text-shadow: 0 2px 12px rgba(0,0,0,0.25); }
      .cover-dest { font-size: 20px; font-weight: 600; opacity: 0.95; }
      .cover-foot { font-size: 12px; opacity: 0.9; }
      .cover-rule { width: 60px; height: 5px; border-radius: 3px; background: #34d399; margin: 18px 0; }

      /* ---------- Contenu ---------- */
      .content { padding-top: 4mm; }
      h1 { font-size: 22px; font-weight: 800; margin: 24px 0 10px; color: #0b1120; }
      h2 {
        font-size: 17px; font-weight: 800; color: #0b1120;
        margin: 26px 0 10px; padding-bottom: 5px;
        border-bottom: 2px solid #e0e7ff;
        page-break-after: avoid;
      }
      h3 {
        font-size: 13.5px; font-weight: 700; color: #4338ca;
        margin: 18px 0 6px; padding: 6px 12px;
        background: linear-gradient(100deg, #eef2ff, rgba(255,255,255,0));
        border-left: 4px solid #6366f1; border-radius: 6px;
        page-break-after: avoid;
      }
      p { margin: 0 0 10px; }
      strong { color: #0b1120; font-weight: 700; }
      a { color: #4f46e5; text-decoration: none; }
      ul, ol { margin: 0 0 12px; padding-left: 20px; }
      li { margin-bottom: 5px; }

      /* Tables */
      .table-wrap { margin: 14px 0; }
      table { width: 100%; border-collapse: collapse; font-size: 10.5px; border-radius: 8px; overflow: hidden; border: 1px solid #e0e7ff; }
      thead { background: linear-gradient(135deg, #4f46e5, #7c3aed); }
      th { color: #fff; text-align: left; padding: 8px 10px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.4px; }
      td { padding: 7px 10px; border-bottom: 1px solid #eef2ff; vertical-align: top; }
      tbody tr:nth-child(even) { background: #f8fafc; }
      td:first-child { font-weight: 600; color: #0b1120; }

      /* Blockquote / encadré */
      blockquote {
        margin: 14px 0; padding: 12px 16px;
        background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 0 8px 8px 0;
        color: #92400e; font-size: 11px;
      }

      /* Checklist */
      ul.checklist { list-style: none; padding-left: 0; }
      ul.checklist li { position: relative; padding-left: 28px; margin-bottom: 8px; }
      ul.checklist li .box {
        position: absolute; left: 0; top: 0;
        width: 18px; height: 18px; border: 2px solid #6366f1; border-radius: 5px;
        display: inline-flex; align-items: center; justify-content: center;
        color: #4f46e5; font-weight: 800; font-size: 12px;
      }

      hr { border: none; height: 1px; background: #e2e8f0; margin: 18px 0; }

      .footer { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 12px; color: #94a3b8; font-size: 9px; }
    </style>
  </head>
  <body>
    <section class="cover">
      ${coverPhoto}
      <div class="cover-overlay"></div>
      <div class="cover-brand">TripPilot Guides</div>
      <div class="cover-center">
        <span class="cover-kicker">${escapeHtml(kicker)}</span>
        <div class="cover-title">${escapeHtml(title)}</div>
        <div class="cover-rule"></div>
        ${dest ? `<div class="cover-dest">${escapeHtml(dest)}</div>` : ""}
      </div>
      <div class="cover-foot">Itinéraire · Budget · Quartiers · Transports · Checklist<br/>trippilotguides.com</div>
    </section>

    <main class="content">
      ${body}
      <div class="footer">
        Guide numérique TripPilot Guides — usage personnel. Les prix, horaires et conditions
        peuvent évoluer : vérifiez toujours les informations importantes avant votre départ.
      </div>
    </main>
  </body>
</html>`;
}
