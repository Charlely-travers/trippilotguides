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

async function mistralChat(messages, { json = true, temperature = 0.4, maxTokens } = {}) {
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
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Réponse Mistral vide");
  return content;
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

  const md = (
    await mistralChat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { json: false, temperature: 0.6, maxTokens: 4000 }
    )
  ).trim();
  // Retire un éventuel bloc de code englobant ```markdown ... ```
  return md.replace(/^```(?:markdown)?\s*/i, "").replace(/```$/i, "").trim();
}

/** Plan de guide PDF : Markdown BRUT, avec repli local si l'IA échoue. */
async function generateGuideOutlineMarkdown(research) {
  const system =
    "Tu es concepteur de guides de voyage PDF premium pour TripPilot Guides. " +
    "Tu réponds en Markdown BRUT (pas de JSON, pas de bloc de code englobant).";
  const user =
    "DONNÉES DE RECHERCHE :\n" +
    researchContext(research) +
    "\n\n" +
    "Rédige UNIQUEMENT, en Markdown, un plan de production COMPLET de guide PDF contenant :\n" +
    "- ## Structure du PDF (sections ordonnées)\n" +
    "- ## Pages prévues (sommaire avec numéros de page indicatifs)\n" +
    "- ## Tableaux budget (≥ 2 tableaux Markdown : par jour ; par poste bas/moyen/confort)\n" +
    "- ## Planning type d'une journée (tableau Matin / Midi / Après-midi / Soir)\n" +
    "- ## Alternatives pluie / fatigue\n" +
    "- ## Checklist imprimable (cases '- [ ]')\n" +
    "- ## Liens à vérifier\n" +
    "- ## Éléments visuels à créer dans Canva\n\n" +
    "Ne mets pas de bloc ```; renvoie directement le Markdown.";

  const md = (
    await mistralChat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { json: false, temperature: 0.5, maxTokens: 3000 }
    )
  ).trim();
  const clean = md.replace(/^```(?:markdown)?\s*/i, "").replace(/```$/i, "").trim();
  if (clean.length < 80) throw new Error("guide outline trop court");
  return clean;
}

/** Repli local du plan de guide à partir de la recherche (jamais d'échec). */
function buildGuideFallback(research) {
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

  lines.push(`\n## Budget`);
  lines.push(`| Poste | Bas | Moyen | Confort |`);
  lines.push(`| --- | --- | --- | --- |`);
  lines.push(`| Hébergement / nuit | à vérifier | à vérifier | à vérifier |`);
  lines.push(`| Repas / jour | à vérifier | à vérifier | à vérifier |`);
  lines.push(`| Transports | à vérifier | à vérifier | à vérifier |`);
  lines.push(`| Visites | à vérifier | à vérifier | à vérifier |`);

  lines.push(`\n## Transports`);
  (research.transports?.length ? research.transports : ["À compléter (aéroport, transports sur place)."]).forEach(
    (t) => lines.push(`- ${t}`)
  );

  lines.push(`\n## Quartiers où dormir`);
  (research.neighborhoods?.length ? research.neighborhoods : ["À compléter selon le budget."]).forEach(
    (n) => lines.push(`- ${n}`)
  );

  if (research.restaurants?.length) {
    lines.push(`\n## Restaurants / pauses (à vérifier)`);
    research.restaurants.forEach((r) => lines.push(`- ${r}`));
  }

  lines.push(`\n## Checklist imprimable`);
  ["Documents", "Budget et moyens de paiement", "Transport (billets, pass)", "Logement (adresse, check-in)", "Valise", "Applis utiles"].forEach(
    (c) => lines.push(`- [ ] ${c}`)
  );

  return lines.join("\n");
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

/** Contenus réseaux sociaux : Markdown BRUT (avec normalisation si JSON renvoyé). */
async function generateSocialMarkdown(research) {
  const system =
    "Tu es social media manager voyage pour TripPilot Guides. " +
    "Accroches en français jouant sur l'émotion/le problème du voyageur, menant à la " +
    "checklist gratuite ou au guide PDF complet. Tu réponds en Markdown BRUT.";
  const user =
    "DONNÉES DE RECHERCHE :\n" +
    researchContext(research) +
    "\n\n" +
    "Rédige UNIQUEMENT, en Markdown, ces trois sections :\n" +
    "## 📌 Idées Pinterest (10)\n(liste numérotée de 10 titres d'épingles avec hashtags)\n\n" +
    "## 🎬 Hooks TikTok / Reels (10)\n(liste numérotée de 10 accroches qui stoppent le scroll)\n\n" +
    "## 📝 Scripts courts (5)\n(5 scripts de 15-30s : accroche + corps + CTA vers checklist ou guide)\n\n" +
    "Angle émotionnel/problème. Ne mets pas de bloc ```; renvoie directement le Markdown.";

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
  if (looksLikeJson(raw)) {
    try {
      const parsed = safeParseJson(raw);
      const md = socialJsonToMarkdown(parsed);
      if (md) return md;
    } catch {
      /* on retombe sur le brut nettoyé */
    }
  }
  return raw.replace(/^```(?:markdown)?\s*/i, "").replace(/```$/i, "").trim();
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

function assembleBlogMarkdown(blogMarkdown, research) {
  let md = blogMarkdown.trim();
  md += verificationBox(research);
  md += ctaBlock();
  md += sourcesSection(research);
  if (!/prix et horaires peuvent évoluer/i.test(md)) {
    md += `\n\n> ${DISCLAIMER}\n`;
  }
  return md;
}

async function writeDraftFiles(slug, meta, blogMarkdown, guideMarkdown, socialMarkdown, research) {
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
    blogFm + "\n" + assembleBlogMarkdown(blogMarkdown || "", research) + "\n",
    "utf8"
  );
  written.push(path.relative(ROOT, blogPath));

  // 2) Plan de guide PDF (toujours présent grâce au repli)
  const guidePath = path.join(dir, "guide-outline.md");
  await fs.writeFile(
    guidePath,
    `# Plan de guide PDF — ${meta.title || research.idea}\n\n` +
      "> Brouillon généré automatiquement. `draft: true`. À relire avant toute utilisation.\n\n" +
      `${guideMarkdown}\n` +
      sourcesSection(research) +
      verificationBox(research),
    "utf8"
  );
  written.push(path.relative(ROOT, guidePath));

  // 3) Social (toujours présent ; jamais de [object Object])
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
      const blogMarkdown = await generateBlogMarkdown(data);

      // Guide : IA puis repli local garanti (jamais d'échec)
      let guideMarkdown = "";
      try {
        guideMarkdown = await generateGuideOutlineMarkdown(data);
      } catch (err) {
        summary.errors.push(`Guide "${slug}" : ${err.message} (repli local)`);
        guideMarkdown = buildGuideFallback(data);
      }
      if (!guideMarkdown || guideMarkdown.length < 40) guideMarkdown = buildGuideFallback(data);

      // Social : Markdown brut (normalisé si JSON) ; repli minimal sinon
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

      const files = await writeDraftFiles(
        slug,
        meta,
        blogMarkdown,
        guideMarkdown,
        socialMarkdown,
        data
      );
      summary.mistralUsed = true;
      summary.generated.push({
        idea: data.idea,
        slug,
        files,
        researchUsed: true,
        researchMethod: data.method,
        sourcesCount: data.sources?.length || 0,
        needsVerificationCount: data.needsVerification?.length || 0,
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
