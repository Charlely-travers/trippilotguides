/**
 * TripPilot Guides — PDF Delivery Template V3 (style magazine)
 *
 * Transforme le markdown d'un guide en HTML premium prêt pour Playwright → PDF.
 * Design : couverture photo, sommaire, jours sur pages séparées avec bandeaux,
 * encadrés tips/attention, restaurants en cartes, pagination, checklist cochable.
 */

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

/* ═══════════════ Nettoyage Markdown ═══════════════ */

function stripFrontmatter(md) {
  return String(md || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

const INTERNAL_SECTION_RE =
  /^(structure du pdf|pages?\s+pr[ée]vues?|[ée]l[ée]ments?\s+visuels|liens?\s+[àa]\s+v[ée]rifier)\b/i;

export function cleanGuideMarkdown(md) {
  let text = stripFrontmatter(md);
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  const lines = text.split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const titleText = heading[2].trim();
      if (INTERNAL_SECTION_RE.test(titleText)) { skipping = true; continue; }
      if (level === 1) continue;
      skipping = false;
    }
    if (skipping) continue;
    if (/^>\s*(source interne|brouillon g[ée]n[ée]r[ée])/i.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ═══════════════ Markdown → HTML (enrichi) ═══════════════ */

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

/** Détecte un H3 qui commence un nouveau jour (### Jour X — ...) */
function isDayHeading(line) {
  return /^###\s+Jour\s+\d/i.test(line.trim());
}

/** Détecte un pattern "Astuce :" ou "À savoir :" pour créer un encadré tip */
function isTipLine(text) {
  return /^(astuce|conseil|bon plan|à savoir)\s*:/i.test(text.trim());
}

/** Détecte un pattern "Attention :" ou "À éviter :" pour un encadré warning */
function isWarningLine(text) {
  return /^(attention|à éviter|important|vigilance)\s*:/i.test(text.trim());
}

// SVG icons inline (small, embedded)
const ICON_TIP = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
const ICON_WARN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
const ICON_CLOCK = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const ICON_EURO = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>`;

function markdownBodyToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let i = 0;
  let listType = null;

  const closeList = () => {
    if (listType === "ul" || listType === "check") html.push("</ul>");
    else if (listType === "ol") html.push("</ol>");
    listType = null;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { closeList(); i++; continue; }

    // Table
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
      html.push("<thead><tr>" + header.map((c) => `<th>${inlineMarkdown(c)}</th>`).join("") + "</tr></thead>");
      html.push("<tbody>");
      for (const row of rows) {
        html.push("<tr>" + row.map((c) => `<td>${inlineMarkdown(c)}</td>`).join("") + "</tr>");
      }
      html.push("</tbody></table></div>");
      continue;
    }

    // H3 Day heading → page break + day banner
    if (isDayHeading(trimmed)) {
      closeList();
      const title = trimmed.replace(/^###\s+/, "");
      html.push(`<div class="day-banner"><span class="day-banner-label">${inlineMarkdown(title)}</span></div>`);
      i++;
      continue;
    }

    // H3 (other)
    let m;
    if ((m = trimmed.match(/^###\s+(.*)$/))) {
      closeList();
      html.push(`<h3>${inlineMarkdown(m[1])}</h3>`);
      i++;
      continue;
    }
    // H2
    if ((m = trimmed.match(/^##\s+(.*)$/))) {
      closeList();
      html.push(`<h2>${inlineMarkdown(m[1])}</h2>`);
      i++;
      continue;
    }

    // Separator
    if (/^---+$/.test(trimmed)) { closeList(); html.push("<hr/>"); i++; continue; }

    // Checklist
    if ((m = trimmed.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/))) {
      if (listType !== "check") { closeList(); html.push('<ul class="checklist">'); listType = "check"; }
      const checked = m[1].toLowerCase() === "x";
      html.push(`<li class="${checked ? "checked" : ""}"><span class="box">${checked ? "✓" : ""}</span>${inlineMarkdown(m[2])}</li>`);
      i++;
      continue;
    }

    // Bullet list
    if ((m = trimmed.match(/^[-*]\s+(.*)$/))) {
      if (listType !== "ul") { closeList(); html.push("<ul>"); listType = "ul"; }
      html.push(`<li>${inlineMarkdown(m[1])}</li>`);
      i++;
      continue;
    }

    // Numbered list
    if ((m = trimmed.match(/^\d+[.)]\s+(.*)$/))) {
      if (listType !== "ol") { closeList(); html.push("<ol>"); listType = "ol"; }
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
      html.push(`<blockquote>${quoteLines.map((q) => inlineMarkdown(q)).join("<br/>")}</blockquote>`);
      continue;
    }

    // Paragraph with special callouts
    closeList();
    const plainText = trimmed.replace(/\*\*/g, "");
    if (isTipLine(plainText)) {
      html.push(`<div class="callout callout-tip">${ICON_TIP}<p>${inlineMarkdown(trimmed)}</p></div>`);
    } else if (isWarningLine(plainText)) {
      html.push(`<div class="callout callout-warn">${ICON_WARN}<p>${inlineMarkdown(trimmed)}</p></div>`);
    } else {
      html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
    }
    i++;
  }
  closeList();
  return html.join("\n");
}

/* ═══════════════ Template HTML complet ═══════════════ */

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
      @page { size: A4; margin: 14mm 15mm 18mm; }
      @page :first { margin: 0; }
      * { box-sizing: border-box; }
      body {
        font-family: "Helvetica Neue", Arial, sans-serif;
        color: #1e293b;
        line-height: 1.65;
        font-size: 11px;
        margin: 0;
        counter-reset: page-counter;
      }

      /* ════ COUVERTURE ════ */
      .cover {
        position: relative;
        height: 297mm; width: 210mm;
        background: linear-gradient(150deg, #312e81 0%, #6d28d9 50%, #0f766e 100%);
        color: #fff;
        padding: 28mm 22mm;
        display: flex; flex-direction: column; justify-content: space-between;
        page-break-after: always;
        overflow: hidden;
      }
      .cover-photo { position: absolute; inset: 0; background-size: cover; background-position: center; opacity: 0.5; }
      .cover-overlay { position: absolute; inset: 0; background: linear-gradient(160deg, rgba(49,46,129,0.78), rgba(109,40,217,0.65) 50%, rgba(15,118,110,0.82)); }
      .cover-brand, .cover-center, .cover-foot { position: relative; z-index: 2; }
      .cover-brand { font-size: 15px; font-weight: 800; letter-spacing: 0.4px; opacity: 0.92; }
      .cover-kicker { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 3.5px; background: rgba(255,255,255,0.16); padding: 5px 14px; border-radius: 999px; margin-bottom: 14px; }
      .cover-title { font-size: 40px; line-height: 1.08; font-weight: 800; margin: 0 0 12px; text-shadow: 0 2px 10px rgba(0,0,0,0.3); }
      .cover-dest { font-size: 18px; font-weight: 600; opacity: 0.95; margin-top: 4px; }
      .cover-rule { width: 50px; height: 4px; border-radius: 2px; background: #34d399; margin: 14px 0; }
      .cover-foot { font-size: 11px; opacity: 0.88; line-height: 1.5; }

      /* ════ CONTENU ════ */
      .content { padding-top: 2mm; }

      h2 {
        font-size: 16px; font-weight: 800; color: #1e1b4b;
        margin: 28px 0 10px; padding-bottom: 6px;
        border-bottom: 2.5px solid #e0e7ff;
        page-break-after: avoid;
      }
      h3 {
        font-size: 12.5px; font-weight: 700; color: #4338ca;
        margin: 18px 0 6px; padding: 7px 12px;
        background: linear-gradient(100deg, #eef2ff, rgba(255,255,255,0));
        border-left: 3.5px solid #6366f1; border-radius: 5px;
        page-break-after: avoid;
      }

      /* ════ DAY BANNER ════ */
      .day-banner {
        page-break-before: always;
        margin: 0 -15mm 16px; padding: 18px 22mm;
        background: linear-gradient(100deg, #4f46e5, #7c3aed);
        color: #fff;
      }
      .day-banner-label { font-size: 16px; font-weight: 800; letter-spacing: -0.3px; }

      p { margin: 0 0 9px; }
      strong { color: #0f172a; font-weight: 700; }
      em { font-style: italic; color: #475569; }
      a { color: #4f46e5; text-decoration: none; }
      code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 10px; }

      ul, ol { margin: 0 0 10px; padding-left: 18px; }
      li { margin-bottom: 5px; }
      ol { counter-reset: li; list-style: none; padding-left: 0; }
      ol > li { position: relative; padding-left: 26px; counter-increment: li; }
      ol > li::before {
        content: counter(li);
        position: absolute; left: 0; top: 0;
        width: 18px; height: 18px; border-radius: 50%;
        background: linear-gradient(135deg, #6366f1, #7c3aed);
        color: #fff; font-size: 10px; font-weight: 700;
        display: flex; align-items: center; justify-content: center;
      }

      /* ════ TABLES ════ */
      .table-wrap { margin: 12px 0; border-radius: 7px; overflow: hidden; border: 1px solid #e0e7ff; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; }
      thead { background: linear-gradient(135deg, #4f46e5, #7c3aed); }
      th { color: #fff; padding: 7px 9px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 700; }
      td { padding: 6px 9px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
      tbody tr:nth-child(even) { background: #f8fafc; }
      td:first-child { font-weight: 600; color: #1e1b4b; }

      /* ════ CALLOUTS ════ */
      .callout {
        display: flex; gap: 10px; align-items: flex-start;
        margin: 12px 0; padding: 10px 14px;
        border-radius: 8px; font-size: 10.5px;
      }
      .callout p { margin: 0; }
      .callout-tip { background: #ecfdf5; border: 1px solid #a7f3d0; }
      .callout-warn { background: #fffbeb; border: 1px solid #fde68a; }

      /* ════ CHECKLIST ════ */
      ul.checklist { list-style: none; padding-left: 0; }
      ul.checklist li { position: relative; padding-left: 26px; margin-bottom: 7px; }
      ul.checklist li .box {
        position: absolute; left: 0; top: 1px;
        width: 16px; height: 16px; border: 2px solid #6366f1; border-radius: 4px;
        display: inline-flex; align-items: center; justify-content: center;
        color: #4f46e5; font-weight: 800; font-size: 11px;
      }

      blockquote {
        margin: 12px 0; padding: 10px 14px;
        background: #fffbeb; border-left: 3.5px solid #f59e0b; border-radius: 0 7px 7px 0;
        color: #92400e; font-size: 10.5px;
      }
      blockquote p { margin: 0 0 4px; }

      hr { border: none; height: 1.5px; background: linear-gradient(90deg, transparent, #c7d2fe, transparent); margin: 16px 0; }

      /* ════ FOOTER ════ */
      .page-footer {
        position: fixed; bottom: 0; left: 0; right: 0;
        padding: 6px 15mm;
        font-size: 8.5px; color: #94a3b8;
        display: flex; justify-content: space-between;
        border-top: 1px solid #e2e8f0;
      }
      .disclaimer {
        margin-top: 28px; padding-top: 10px; border-top: 1px solid #e2e8f0;
        font-size: 8.5px; color: #94a3b8; line-height: 1.5;
      }
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
      <div class="disclaimer">
        Guide numérique TripPilot Guides — usage personnel.
        Les prix, horaires et conditions peuvent évoluer : vérifiez toujours les informations importantes avant votre départ.
      </div>
    </main>
  </body>
</html>`;
}
