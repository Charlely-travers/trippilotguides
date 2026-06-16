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

/* ---------------- Générateurs (à partir de la recherche) ---------------- */

async function generateBlog(research) {
  const system =
    "Tu es rédacteur web SEO francophone senior pour TripPilot Guides (guides de voyage PDF). " +
    "Tu écris un français clair, concret et fiable, orienté conversion mais JAMAIS mensonger. " +
    "Tu t'appuies UNIQUEMENT sur les données de recherche fournies. Pour toute information " +
    "absente, incertaine ou non sourcée, tu restes prudent (« à vérifier », « en général », " +
    "« comptez environ ») et tu ne donnes pas de prix ou d'horaire comme certains. " +
    "Réponds STRICTEMENT en JSON.";
  const user =
    "DONNÉES DE RECHERCHE :\n" +
    researchContext(research) +
    "\n\n" +
    "Rédige un article de blog COMPLET en français de 1200 à 1600 mots fondé sur ces données. " +
    'Renvoie un objet JSON {"blogTitle": string (55-65 car.), "blogDescription": string (140-160 car.), ' +
    '"emoji": string, "blogMarkdown": string}.\n\n' +
    "blogMarkdown (Markdown, titres ## et ###, PAS de # car le titre est dans le frontmatter), dans cet ordre :\n" +
    "1. Intro avec angle commercial clair (problème du lecteur + promesse).\n" +
    "2. ## Itinéraire jour par jour (matin/après-midi/soir).\n" +
    "3. ## Budget détaillé — tableau Markdown avec 3 niveaux (routard / équilibré / confort), montants indicatifs.\n" +
    "4. ## Erreurs à éviter.\n" +
    "5. ## Transports (aéroport et sur place).\n" +
    "6. ## Où dormir (quartiers selon budget).\n" +
    "7. ## Quoi réserver avant de partir.\n\n" +
    "N'invente pas de prix précis ni d'adresses non présents dans les données ; reste prudent. " +
    "N'ajoute pas toi-même l'encadré « à vérifier », les sources, les CTA ni le disclaimer : ils seront ajoutés ensuite.";

  const content = await mistralChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.6, maxTokens: 4000 }
  );
  const parsed = safeParseJson(content);
  if (!parsed?.blogMarkdown) throw new Error("blogMarkdown manquant");
  return parsed;
}

async function generateGuideOutline(research) {
  const system =
    "Tu es concepteur de guides de voyage PDF premium pour TripPilot Guides. " +
    "Tu t'appuies sur les données de recherche fournies et restes prudent sur les infos non sourcées. " +
    "Réponds STRICTEMENT en JSON.";
  const user =
    "DONNÉES DE RECHERCHE :\n" +
    researchContext(research) +
    "\n\n" +
    'Renvoie {"guideOutline": string} : un plan de production COMPLET en Markdown contenant :\n' +
    "- ## Structure du PDF (sections ordonnées)\n" +
    "- ## Pages prévues (sommaire avec numéros de page indicatifs)\n" +
    "- ## Tableaux budget (≥ 2 tableaux Markdown : budget par jour ; budget par poste bas/moyen/confort)\n" +
    "- ## Planning type d'une journée (tableau Matin / Midi / Après-midi / Soir)\n" +
    "- ## Alternatives pluie / fatigue\n" +
    "- ## Checklist imprimable (cases '- [ ]')\n" +
    "- ## Liens à vérifier (reprends les sources et points à vérifier des données)\n" +
    "- ## Éléments visuels à créer dans Canva (couverture, cartes, icônes, encadrés budget)\n";

  const content = await mistralChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.5, maxTokens: 3000 }
  );
  const parsed = safeParseJson(content);
  return String(parsed?.guideOutline || "").trim();
}

async function generateSocial(research) {
  const system =
    "Tu es social media manager spécialisé voyage pour TripPilot Guides. " +
    "Accroches en français jouant sur l'émotion/le problème du voyageur, menant à la " +
    "checklist gratuite ou au guide PDF. Réponds STRICTEMENT en JSON.";
  const user =
    "DONNÉES DE RECHERCHE :\n" +
    researchContext(research) +
    "\n\n" +
    'Renvoie {"pinterest":[10 idées d\'épingles (titre + angle, avec hashtags)],' +
    '"hooks":[10 hooks TikTok/Reels (1re phrase qui stoppe le scroll)],' +
    '"scripts":[5 scripts 15-30s, chacun accroche + corps + CTA vers checklist ou guide]}. ' +
    "Angle émotionnel/problème (stress d'organisation, peur de se tromper, budget, premier voyage).";

  const content = await mistralChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.85, maxTokens: 2500 }
  );
  const parsed = safeParseJson(content);
  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  return {
    pinterest: arr(parsed?.pinterest),
    hooks: arr(parsed?.hooks),
    scripts: arr(parsed?.scripts),
  };
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

async function writeDraftFiles(slug, blog, guideOutline, social, research) {
  const dir = path.join(DRAFTS_DIR, slug);
  await fs.mkdir(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const written = [];

  // 1) Article de blog
  const blogFm = frontmatter({
    title: blog.blogTitle || research.idea,
    description: blog.blogDescription || research.idea,
    pubDate: today,
    emoji: blog.emoji || "📍",
    gradient: "from-brand-500 via-accent-500 to-accent-600",
    readingTime: "9 min",
    draft: true,
  });
  const blogPath = path.join(dir, "blog.md");
  await fs.writeFile(
    blogPath,
    blogFm + "\n" + assembleBlogMarkdown(blog.blogMarkdown || "", research) + "\n",
    "utf8"
  );
  written.push(path.relative(ROOT, blogPath));

  // 2) Plan de guide PDF
  if (guideOutline) {
    const guidePath = path.join(dir, "guide-outline.md");
    await fs.writeFile(
      guidePath,
      `# Plan de guide PDF — ${blog.blogTitle || research.idea}\n\n` +
        "> Brouillon généré automatiquement. `draft: true`. À relire avant toute utilisation.\n\n" +
        `${guideOutline}\n` +
        sourcesSection(research),
      "utf8"
    );
    written.push(path.relative(ROOT, guidePath));
  }

  // 3) Social
  const hasSocial =
    social && (social.pinterest?.length || social.hooks?.length || social.scripts?.length);
  if (hasSocial) {
    const numbered = (list) => (list || []).map((x, i) => `${i + 1}. ${x}`).join("\n");
    const scripts = (social.scripts || [])
      .map((s, i) => `### Script ${i + 1}\n\n${s}\n`)
      .join("\n");
    const socialPath = path.join(dir, "social.md");
    await fs.writeFile(
      socialPath,
      `# Posts social — ${blog.blogTitle || research.idea}\n\n` +
        "> Brouillon généré automatiquement. `draft: true`.\n\n" +
        `## 📌 Idées Pinterest (10)\n\n${numbered(social.pinterest)}\n\n` +
        `## 🎬 Hooks TikTok / Reels (10)\n\n${numbered(social.hooks)}\n\n` +
        `## 📝 Scripts courts (5)\n\n${scripts}\n`,
      "utf8"
    );
    written.push(path.relative(ROOT, socialPath));
  }

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
      const blog = await generateBlog(data);

      let guideOutline = "";
      let social = { pinterest: [], hooks: [], scripts: [] };
      try {
        guideOutline = await generateGuideOutline(data);
      } catch (err) {
        summary.errors.push(`Guide "${slug}" : ${err.message}`);
      }
      try {
        social = await generateSocial(data);
      } catch (err) {
        summary.errors.push(`Social "${slug}" : ${err.message}`);
      }

      const files = await writeDraftFiles(slug, blog, guideOutline, social, data);
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
