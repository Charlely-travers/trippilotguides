/**
 * TripPilot Guides — Automatisation V1 (génération de brouillons).
 *
 * Part des dossiers de RECHERCHE produits par research.mjs (automation/research/*.json)
 * et génère des brouillons FONDÉS sur ces données :
 *   - blog.md           (article long, orienté conversion)
 *   - guide-outline.md  (plan de production du guide PDF)
 *   - social.md         (Pinterest / hooks / scripts)
 *
 * Règles :
 *  - On s'appuie sur les données recherchées (attractions, transports, quartiers…).
 *  - On évite toute affirmation certaine non sourcée : les infos incertaines sont
 *    listées dans un encadré « ⚠️ À vérifier avant le départ » et les sources citées.
 *  - Brouillons écrits dans automation/drafts/ (HORS de src/content) : jamais publiés.
 *  - Toute erreur est capturée ; sortie 0 pour ne pas bloquer build/notify.
 *
 * Aucune dépendance externe : `fetch` natif (Node 18+).
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const RESEARCH_DIR = path.join(ROOT, "automation", "research");
const OUT_DIR = path.join(ROOT, "automation", "output");
const SUMMARY_FILE = path.join(OUT_DIR, "summary.json");
const DRAFTS_DIR = path.join(ROOT, "automation", "drafts");

const API_KEY = process.env.MISTRAL_API_KEY;
const MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";
const API_URL = "https://api.mistral.ai/v1/chat/completions";

const DISCLAIMER =
  "Les prix et horaires peuvent évoluer. Vérifiez toujours les informations importantes avant votre départ.";

function slugify(str) {
  return str
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("JSON Mistral non parsable");
  }
}

async function mistralChatFull(messages, { json = true, temperature = 0.4, maxTokens } = {}) {
  if (!API_KEY) throw new Error("MISTRAL_API_KEY manquante");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      messages,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mistral HTTP ${res.status} — ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (!content) throw new Error("Réponse Mistral vide");
  // finish_reason "length" => réponse tronquée par la limite de tokens
  return { content, finishReason: choice?.finish_reason || "stop" };
}

async function mistralChat(messages, opts) {
  return (await mistralChatFull(messages, opts)).content;
}

/* ---------------- Contexte de recherche ---------------- */

function researchContext(r) {
  const list = (arr, f) => (arr || []).map(f).join("\n");
  return [
    `Destination : ${r.destination}`,
    `Angle : ${r.angle || "(à définir)"}`,
    r.attractions?.length
      ? "Attractions :\n" +
        list(r.attractions, (a) =>
          `- ${a.name}${a.priceIndicatif ? ` (prix indicatif : ${a.priceIndicatif})` : ""}${a.url ? ` — ${a.url}` : ""}`
        )
      : "",
    r.transports?.length ? "Transports :\n" + list(r.transports, (t) => `- ${t}`) : "",
    r.neighborhoods?.length ? "Quartiers :\n" + list(r.neighborhoods, (n) => `- ${n}`) : "",
    r.restaurants?.length ? "Restaurants/types :\n" + list(r.restaurants, (x) => `- ${x}`) : "",
    r.attentionPoints?.length ? "Points d'attention :\n" + list(r.attentionPoints, (x) => `- ${x}`) : "",
    r.keywords?.length ? `Mots-clés SEO/Pinterest : ${r.keywords.join(", ")}` : "",
    r.sources?.length
      ? "Sources disponibles :\n" + list(r.sources, (s) => `- ${s.title} : ${s.url}`)
      : "Sources : aucune (à considérer comme NON vérifié).",
    r.needsVerification?.length
      ? "À vérifier : " + r.needsVerification.join(" ; ")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ---------------- Générateurs (Markdown brut, 3 appels séparés) ---------------- */

function looksLikeJson(text) {
  const t = text.trim();
  return t.startsWith("{") || t.startsWith("[");
}

/** Petit JSON de métadonnées (robuste, avec repli déterministe). */
async function generateBlogMeta(research) {
  const fallback = {
    title: research.angle || `${research.destination} : guide pratique`,
    description:
      (research.angle || `Préparez votre voyage à ${research.destination}.`).slice(0, 155),
    emoji: "📍",
  };
  try {
    const content = await mistralChat(
      [
        {
          role: "system",
          content:
            "Tu génères des métadonnées SEO en français. Réponds STRICTEMENT en JSON.",
        },
        {
          role: "user",
          content:
            `Sujet : "${research.idea}" (destination : ${research.destination}).\n` +
            'Renvoie {"title": string (55-65 car.), "description": string (140-160 car.), "emoji": string (un emoji)}.',
        },
      ],
      { temperature: 0.4, maxTokens: 300 }
    );
    const parsed = safeParseJson(content);
    return {
      title: String(parsed.title || fallback.title).trim(),
      description: String(parsed.description || fallback.description).trim(),
      emoji: String(parsed.emoji || fallback.emoji).trim() || "📍",
    };
  } catch {
    return fallback;
  }
}

/** Article de blog : Markdown BRUT (pas de gros JSON fragile). */
async function generateBlogMarkdown(research) {
  const system =
    "Tu es rédacteur web SEO francophone senior pour TripPilot Guides (guides de voyage PDF). " +
    "Tu écris un français clair, concret et fiable, orienté conversion mais JAMAIS mensonger. " +
    "Tu t'appuies UNIQUEMENT sur les données de recherche fournies ; pour toute information " +
    "absente ou non sourcée, tu restes prudent (« à vérifier », « comptez environ »). " +
    "Tu réponds en Markdown BRUT (pas de JSON, pas de bloc de code englobant).";
  const user =
    "DONNÉES DE RECHERCHE :\n" +
    researchContext(research) +
    "\n\n" +
    "Rédige UNIQUEMENT le corps d'un article de blog en français de 1200 à 1600 mots, en Markdown. " +
    "Titres ## et ### (PAS de # : le titre est géré ailleurs). Structure, dans cet ordre :\n" +
    "- Une introduction avec un angle commercial clair (problème du lecteur + promesse).\n" +
    "- ## Itinéraire jour par jour (matin/après-midi/soir).\n" +
    "- ## Budget détaillé : tableau Markdown à 3 niveaux (routard / équilibré / confort), montants indicatifs.\n" +
    "- ## Erreurs à éviter.\n" +
    "- ## Transports (aéroport et sur place).\n" +
    "- ## Où dormir (quartiers selon budget).\n" +
    "- ## Quoi réserver avant de partir.\n\n" +
    "N'ajoute PAS l'encadré « à vérifier », les sources, les CTA ni le disclaimer : ils seront ajoutés ensuite. " +
    "Ne mets pas de bloc ```; renvoie directement le Markdown.";

  const { content, finishReason } = await mistralChatFull(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { json: false, temperature: 0.6, maxTokens: 4000 }
  );
  const markdown = content
    .trim()
    .replace(/^```(?:markdown)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return { markdown, complete: finishReason !== "length" };
}

/** Plan de guide PDF : 3 appels séparés (évite la troncature), assemblés. */
async function generateGuidePart(research, instructions, maxTokens) {
  const system =
    "Tu es concepteur de guides de voyage PDF premium pour TripPilot Guides. " +
    "Tu réponds en Markdown BRUT (pas de JSON, pas de bloc de code englobant).";
  const user =
    "DONNÉES DE RECHERCHE :\n" +
    researchContext(research) +
    "\n\n" +
    instructions +
    "\nNe mets pas de bloc ```; renvoie directement le Markdown.";
  const { content, finishReason } = await mistralChatFull(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { json: false, temperature: 0.5, maxTokens }
  );
  const md = content
    .trim()
    .replace(/^```(?:markdown)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return { md, complete: finishReason !== "length" && md.length >= 40 };
}

async function generateGuideOutlineMarkdown(research) {
  const defs = [
    {
      instr:
        "Rédige UNIQUEMENT, en Markdown :\n" +
        "## Structure du PDF (sections ordonnées)\n" +
        "## Pages prévues (sommaire avec numéros de page indicatifs)\n" +
        "## Budget (≥ 2 tableaux Markdown : par jour ; par poste bas/moyen/confort)",
      maxTokens: 1500,
      fb: () => buildGuideFallbackStructure(research),
    },
    {
      instr:
        "Rédige UNIQUEMENT, en Markdown :\n" +
        "## Itinéraire jour par jour (matin / après-midi / soir, détaillé)\n" +
        "## Planning type d'une journée (tableau Matin / Midi / Après-midi / Soir)\n" +
        "## Alternatives pluie / fatigue",
      maxTokens: 1800,
      fb: () => buildGuideFallbackItinerary(research),
    },
    {
      instr:
        "Rédige UNIQUEMENT, en Markdown :\n" +
        "## Checklist imprimable (cases '- [ ]')\n" +
        "## Éléments visuels à créer dans Canva (couverture, cartes, icônes, encadrés budget)\n" +
        "## Liens à vérifier",
      maxTokens: 1200,
      fb: () => buildGuideFallbackChecklist(research),
    },
  ];

  const parts = [];
  let complete = true;
  for (const d of defs) {
    try {
      const { md, complete: ok } = await generateGuidePart(research, d.instr, d.maxTokens);
      if (ok) {
        parts.push(md);
      } else {
        parts.push(d.fb());
        complete = false;
      }
    } catch {
      parts.push(d.fb());
      complete = false;
    }
  }
  return { markdown: parts.join("\n\n"), complete };
}

/** Replis locaux du plan de guide (par partie), à partir de la recherche. */
function buildGuideFallbackStructure(research) {
  const lines = [];
  lines.push(`## Structure du PDF`);
  lines.push(`1. Couverture`);
  lines.push(`2. Itinéraire jour par jour`);
  lines.push(`3. Budget`);
  lines.push(`4. Transports & quartiers`);
  lines.push(`5. Checklist imprimable`);
  lines.push(`\n## Pages prévues`);
  lines.push(`- p.1 Couverture · p.2 Sommaire · p.3+ Itinéraire · Budget · Checklist`);
  lines.push(`\n## Budget`);
  lines.push(`| Poste | Bas | Moyen | Confort |`);
  lines.push(`| --- | --- | --- | --- |`);
  lines.push(`| Hébergement / nuit | à vérifier | à vérifier | à vérifier |`);
  lines.push(`| Repas / jour | à vérifier | à vérifier | à vérifier |`);
  lines.push(`| Transports | à vérifier | à vérifier | à vérifier |`);
  lines.push(`| Visites | à vérifier | à vérifier | à vérifier |`);
  return lines.join("\n");
}

function buildGuideFallbackItinerary(research) {
  const lines = [];
  const dest = research.destination || research.idea;
  lines.push(`## Itinéraire jour par jour`);
  if (research.attractions?.length) {
    research.attractions.forEach((a, i) => {
      lines.push(
        `- **Jour ${i + 1}** : ${a.name}${a.priceIndicatif ? ` (prix indicatif : ${a.priceIndicatif})` : ""}`
      );
    });
  } else {
    lines.push(`- À compléter avec les incontournables de ${dest}.`);
  }
  lines.push(`\n## Planning type d'une journée`);
  lines.push(`| Matin | Midi | Après-midi | Soir |`);
  lines.push(`| --- | --- | --- | --- |`);
  lines.push(`| Visite principale | Pause déjeuner | Quartier à pied | Dîner |`);
  lines.push(`\n## Alternatives pluie / fatigue`);
  lines.push(`- Musées couverts, café, marché couvert ; journée allégée si besoin.`);
  return lines.join("\n");
}

function buildGuideFallbackChecklist(research) {
  const lines = [];
  lines.push(`## Checklist imprimable`);
  ["Documents", "Budget et moyens de paiement", "Transport (billets, pass)", "Logement (adresse, check-in)", "Valise", "Applis utiles"].forEach(
    (c) => lines.push(`- [ ] ${c}`)
  );
  lines.push(`\n## Éléments visuels à créer dans Canva`);
  lines.push(`- Couverture, carte des quartiers, icônes budget, encadrés « à vérifier ».`);
  lines.push(`\n## Liens à vérifier`);
  if (research.sources?.length) {
    research.sources.forEach((s) => lines.push(`- ${s.title} : ${s.url}`));
  } else {
    lines.push(`- Sites officiels des attractions, transports et hébergements.`);
  }
  return lines.join("\n");
}

function buildGuideFallback(research) {
  return [
    buildGuideFallbackStructure(research),
    buildGuideFallbackItinerary(research),
    buildGuideFallbackChecklist(research),
  ].join("\n\n");
}

/** Conversion robuste d'un item social (string ou objet) en texte lisible. */
function normalizeSocialItem(item) {
  if (item == null) return "";
  if (typeof item === "string") return item;
  if (typeof item === "object") {
    const parts = [];
    if (item.title) parts.push(`**${item.title}**`);
    if (item.hook) parts.push(item.hook);
    if (item.caption) parts.push(item.caption);
    if (item.script) parts.push(item.script);
    if (item.text) parts.push(item.text);
    if (item.idea) parts.push(item.idea);
    if (item.cta) parts.push(`CTA : ${item.cta}`);
    if (item.hashtags)
      parts.push(Array.isArray(item.hashtags) ? item.hashtags.join(" ") : String(item.hashtags));
    const out = parts.filter(Boolean).join(" — ").trim();
    return out || JSON.stringify(item);
  }
  return String(item);
}

/** Reconstruit le Markdown social depuis un JSON (au cas où l'IA renvoie des objets). */
function socialJsonToMarkdown(parsed) {
  const sec = (title, arr) => {
    const items = Array.isArray(arr) ? arr : [];
    if (!items.length) return "";
    return (
      `## ${title}\n\n` +
      items.map((x, i) => `${i + 1}. ${normalizeSocialItem(x)}`).join("\n") +
      "\n\n"
    );
  };
  return (
    sec("📌 Idées Pinterest", parsed.pinterest) +
    sec("🎬 Hooks TikTok / Reels", parsed.hooks) +
    sec("📝 Scripts courts", parsed.scripts)
  ).trim();
}

/** Interdit toute mention d'un guide PDF gratuit/offert (seule la checklist est gratuite). */
function sanitizeSocialText(md) {
  return md
    .replace(/guide(?:\s+pdf)?\s+complet\s+gratuit/gi, "guide PDF complet à acheter")
    .replace(/guide\s+complet\s+gratuit/gi, "guide PDF complet à acheter")
    .replace(/guide\s+pdf\s+gratuit/gi, "guide PDF complet disponible")
    .replace(/guide\s+pdf\s+offert/gi, "guide PDF complet disponible")
    .replace(/guide\s+pdf\s+complet\s+offert/gi, "guide PDF complet disponible")
    .replace(/guide\s+(?:complet\s+)?offert/gi, "guide PDF complet disponible")
    .replace(/guide\s+gratuit/gi, "guide PDF complet à acheter");
}

/** Contenus réseaux sociaux : Markdown BRUT (avec normalisation si JSON renvoyé). */
async function generateSocialMarkdown(research) {
  const system =
    "Tu es social media manager voyage pour TripPilot Guides. " +
    "Accroches en français jouant sur l'émotion/le problème du voyageur. " +
    "RÈGLE STRICTE : seule la CHECKLIST est gratuite. Le guide PDF complet n'est JAMAIS " +
    "gratuit ni offert ; il est payant (« guide PDF complet à acheter »). " +
    "Tu réponds en Markdown BRUT.";
  const user =
    "DONNÉES DE RECHERCHE :\n" +
    researchContext(research) +
    "\n\n" +
    "Rédige UNIQUEMENT, en Markdown, ces trois sections :\n" +
    "## 📌 Idées Pinterest (10)\n(liste numérotée de 10 titres d'épingles avec hashtags)\n\n" +
    "## 🎬 Hooks TikTok / Reels (10)\n(liste numérotée de 10 accroches qui stoppent le scroll)\n\n" +
    "## 📝 Scripts courts (5)\n(5 scripts de 15-30s : accroche + corps + CTA vers la checklist gratuite ou le guide PDF complet à acheter)\n\n" +
    "Angle émotionnel/problème. Ne promets jamais un guide gratuit. Ne mets pas de bloc ```; renvoie directement le Markdown.";

  const raw = (
    await mistralChat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { json: false, temperature: 0.85, maxTokens: 2500 }
    )
  ).trim();

  // Si le modèle a malgré tout renvoyé du JSON, on le normalise (jamais de [object Object]).
  let md;
  if (looksLikeJson(raw)) {
    try {
      const parsed = safeParseJson(raw);
      md = socialJsonToMarkdown(parsed);
    } catch {
      md = raw;
    }
  } else {
    md = raw;
  }
  md = md.replace(/^```(?:markdown)?\s*/i, "").replace(/```$/i, "").trim();
  return sanitizeSocialText(md);
}

/* ---------------- Assemblage déterministe ---------------- */

function frontmatter(obj) {
  const esc = (v) => String(v).replace(/"/g, '\\"');
  const lines = Object.entries(obj).map(([k, v]) => {
    if (typeof v === "boolean" || typeof v === "number") return `${k}: ${v}`;
    return `${k}: "${esc(v)}"`;
  });
  return `---\n${lines.join("\n")}\n---\n`;
}

function verificationBox(research) {
  const items =
    research.needsVerification?.length
      ? research.needsVerification
      : ["Prix, horaires et conditions d'accès des lieux cités"];
  return (
    "\n\n> ⚠️ **À vérifier avant le départ**\n" +
    items.map((i) => `> - ${i}`).join("\n") +
    "\n"
  );
}

function sourcesSection(research) {
  if (!research.sources?.length) {
    return (
      "\n\n## Sources\n\n_Aucune source vérifiée n'a été collectée pour ce brouillon : " +
      "les informations doivent être confirmées avant toute publication._\n"
    );
  }
  return (
    "\n\n## Sources\n\n" +
    research.sources.map((s) => `- [${s.title}](${s.url})`).join("\n") +
    "\n"
  );
}

function ctaBlock() {
  return (
    "\n\n---\n\n" +
    "👉 **Avant de partir :** téléchargez la **checklist gratuite** pour ne rien oublier.\n\n" +
    "👉 **Pour tout planifier :** procurez-vous le **guide PDF complet** (itinéraire jour par jour, " +
    "budget détaillé et checklist imprimable).\n"
  );
}

const BLOG_MARKER = "<!-- TRIPILOT_COMPLETE_BLOG -->";
const GUIDE_MARKER = "<!-- TRIPILOT_COMPLETE_GUIDE -->";

function assembleBlogMarkdown(blogMarkdown, research, complete) {
  let md = blogMarkdown.trim();
  md += verificationBox(research);
  md += ctaBlock();
  md += sourcesSection(research);
  if (!/prix et horaires peuvent évoluer/i.test(md)) {
    md += `\n\n> ${DISCLAIMER}\n`;
  }
  // Marqueur de complétude : ajouté seulement si le contenu n'est pas tronqué.
  if (complete) md += `\n\n${BLOG_MARKER}\n`;
  return md;
}

async function writeDraftFiles(slug, meta, blog, guide, socialMarkdown, research) {
  const dir = path.join(DRAFTS_DIR, slug);
  await fs.mkdir(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const written = [];

  // 1) Article de blog
  const blogFm = frontmatter({
    title: meta.title || research.idea,
    description: meta.description || research.idea,
    pubDate: today,
    emoji: meta.emoji || "📍",
    gradient: "from-brand-500 via-accent-500 to-accent-600",
    readingTime: "9 min",
    draft: true,
  });
  const blogPath = path.join(dir, "blog.md");
  await fs.writeFile(
    blogPath,
    blogFm + "\n" + assembleBlogMarkdown(blog.markdown || "", research, blog.complete) + "\n",
    "utf8"
  );
  written.push(path.relative(ROOT, blogPath));

  // 2) Plan de guide PDF (toujours présent grâce au repli ; marqueur si complet)
  const guidePath = path.join(dir, "guide-outline.md");
  await fs.writeFile(
    guidePath,
    `# Plan de guide PDF — ${meta.title || research.idea}\n\n` +
      "> Brouillon généré automatiquement. `draft: true`. À relire avant toute utilisation.\n\n" +
      `${guide.markdown}\n` +
      sourcesSection(research) +
      verificationBox(research) +
      (guide.complete ? `\n\n${GUIDE_MARKER}\n` : ""),
    "utf8"
  );
  written.push(path.relative(ROOT, guidePath));

  // 3) Social (toujours présent ; jamais de [object Object] ; jamais "guide gratuit")
  const socialPath = path.join(dir, "social.md");
  await fs.writeFile(
    socialPath,
    `# Posts social — ${meta.title || research.idea}\n\n` +
      "> Brouillon généré automatiquement. `draft: true`.\n\n" +
      `${socialMarkdown}\n`,
    "utf8"
  );
  written.push(path.relative(ROOT, socialPath));

  return written;
}

/* ---------------- Orchestration ---------------- */

async function loadResearch() {
  let files = [];
  try {
    files = (await fs.readdir(RESEARCH_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(RESEARCH_DIR, f), "utf8"));
      out.push({ slug: f.replace(/\.json$/, ""), data });
    } catch {
      /* ignore fichier illisible */
    }
  }
  return out;
}

async function loadSummary() {
  try {
    return JSON.parse(await fs.readFile(SUMMARY_FILE, "utf8"));
  } catch {
    return {
      startedAt: new Date().toISOString(),
      model: MODEL,
      scored: [],
      research: { items: [] },
      errors: [],
    };
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const summary = await loadSummary();
  summary.generated = [];
  summary.generatedFiles = [];
  summary.mistralUsed = false;
  if (!Array.isArray(summary.errors)) summary.errors = [];

  const research = await loadResearch();

  if (research.length === 0) {
    summary.errors.push(
      "Aucune donnée de recherche (automation/research/*.json) : lance d'abord research.mjs. Génération ignorée."
    );
    await finish(summary);
    return;
  }
  if (!API_KEY) {
    summary.errors.push(
      "MISTRAL_API_KEY absente : génération ignorée (recherche/build/Discord continuent)."
    );
    await finish(summary);
    return;
  }

  for (const { slug, data } of research) {
    try {
      // 3 appels séparés (Markdown brut) + métadonnées légères
      const meta = await generateBlogMeta(data);
      const blog = await generateBlogMarkdown(data); // { markdown, complete }

      // Guide : 3 appels séparés (assemblés) + repli local garanti
      let guide;
      try {
        guide = await generateGuideOutlineMarkdown(data); // { markdown, complete }
      } catch (err) {
        summary.errors.push(`Guide "${slug}" : ${err.message} (repli local)`);
        guide = { markdown: buildGuideFallback(data), complete: false };
      }
      if (!guide.markdown || guide.markdown.length < 40) {
        guide = { markdown: buildGuideFallback(data), complete: false };
      }

      // Social : Markdown brut (normalisé + assaini)
      let socialMarkdown = "";
      try {
        socialMarkdown = await generateSocialMarkdown(data);
      } catch (err) {
        summary.errors.push(`Social "${slug}" : ${err.message}`);
      }
      if (!socialMarkdown || socialMarkdown.length < 20) {
        socialMarkdown =
          "## 📌 Idées Pinterest\n\n_À compléter._\n\n" +
          "## 🎬 Hooks TikTok / Reels\n\n_À compléter._\n\n" +
          "## 📝 Scripts courts\n\n_À compléter._";
      }

      const files = await writeDraftFiles(slug, meta, blog, guide, socialMarkdown, data);
      summary.mistralUsed = true;
      summary.generated.push({
        idea: data.idea,
        slug,
        files,
        researchUsed: true,
        researchMethod: data.method,
        sourcesCount: data.sources?.length || 0,
        needsVerificationCount: data.needsVerification?.length || 0,
        blogComplete: blog.complete,
        guideComplete: guide.complete,
      });
      summary.generatedFiles.push(...files);
    } catch (err) {
      summary.errors.push(`Génération "${slug}" : ${err.message}`);
    }
  }

  await finish(summary);
}

async function finish(summary) {
  summary.generateFinishedAt = new Date().toISOString();
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
  console.log("=== Génération brouillons ===");
  console.log(`Brouillons : ${summary.generated.length}`);
  console.log(`Fichiers générés : ${summary.generatedFiles.length}`);
  console.log(`Erreurs : ${summary.errors.length}`);
  for (const e of summary.errors) console.log(`  - ${e}`);
}

main().catch(async (err) => {
  const summary = await loadSummary();
  summary.errors = [...(summary.errors || []), `Erreur inattendue : ${err?.message || err}`];
  await finish(summary);
  process.exit(0);
});
