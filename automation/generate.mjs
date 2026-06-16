/**
 * TripPilot Guides — Automatisation V1 (génération de brouillons).
 *
 * Étapes :
 *  1. Lit la liste d'idées (automation/ideas.json)
 *  2. Score les idées avec l'API Mistral (potentiel SEO, monétisation, facilité)
 *  3. Génère des BROUILLONS (blog + plan de guide + posts social) pour les
 *     meilleures idées, avec `draft: true`.
 *  4. Écrit un résumé machine (automation/output/summary.json) consommé par notify.mjs.
 *
 * Sécurité :
 *  - Les brouillons sont écrits dans automation/drafts/ (HORS de src/content),
 *    donc ils ne sont jamais publiés ni inclus dans le build.
 *  - Le script ne publie rien et ne pousse rien.
 *  - Toute erreur est capturée et reportée dans le résumé (sortie 0) pour que
 *    le build et la notification Discord puissent quand même s'exécuter.
 *
 * Aucune dépendance externe : utilise `fetch` natif (Node 18+).
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const IDEAS_FILE = path.join(ROOT, "automation", "ideas.json");
const OUT_DIR = path.join(ROOT, "automation", "output");
const DRAFTS_DIR = path.join(ROOT, "automation", "drafts");

const API_KEY = process.env.MISTRAL_API_KEY;
const MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";
const GENERATE_COUNT = Math.max(
  0,
  Math.min(5, parseInt(process.env.GENERATE_COUNT || "1", 10) || 1)
);

const API_URL = "https://api.mistral.ai/v1/chat/completions";

/**
 * @type {{
 *   startedAt: string, model: string, mistralUsed: boolean,
 *   scored: any[], generated: any[], generatedFiles: string[], errors: string[],
 *   ideasCount?: number, finishedAt?: string
 * }}
 */
const summary = {
  startedAt: new Date().toISOString(),
  model: MODEL,
  mistralUsed: false,
  scored: [],
  generated: [],
  generatedFiles: [],
  errors: [],
};

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

/** Appel chat completions Mistral. Renvoie le contenu texte du message. */
async function mistralChat(messages, { json = true, temperature = 0.4 } = {}) {
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

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // Tente d'extraire le premier bloc {...}
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("JSON Mistral non parsable");
  }
}

/** Étape 2 : scoring des idées. */
async function scoreIdeas(ideas) {
  const system =
    "Tu es un stratège contenu SEO pour une marque française de guides de voyage PDF. " +
    "Tu notes des idées de contenu de 0 à 100 selon trois critères : potentiel SEO, " +
    "potentiel de monétisation (vente d'un guide PDF), et facilité de production. " +
    "Réponds STRICTEMENT en JSON.";
  const user =
    "Note chaque idée suivante. Renvoie un objet JSON de la forme " +
    '{"results":[{"idea":"...","score":0-100,"seo":0-100,"monetisation":0-100,"facilite":0-100,"raison":"une phrase courte en français"}]}. ' +
    "Idées :\n" +
    ideas.map((i, n) => `${n + 1}. ${i}`).join("\n");

  const content = await mistralChat([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  const parsed = safeParseJson(content);
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  // Normalise + trie par score décroissant.
  return results
    .map((r) => ({
      idea: String(r.idea ?? "").trim(),
      score: Number(r.score) || 0,
      seo: Number(r.seo) || 0,
      monetisation: Number(r.monetisation) || 0,
      facilite: Number(r.facilite) || 0,
      raison: String(r.raison ?? "").trim(),
    }))
    .filter((r) => r.idea)
    .sort((a, b) => b.score - a.score);
}

/** Étape 3 : génération des brouillons pour une idée. */
async function generateDraftsForIdea(idea) {
  const system =
    "Tu es rédacteur web SEO francophone pour une marque de guides de voyage PDF (TripPilot Guides). " +
    "Tu écris un français clair, concret et fiable. Tu ne garantis jamais les prix ni les horaires. " +
    "Réponds STRICTEMENT en JSON.";
  const user =
    `Idée de contenu : "${idea}".\n` +
    "Génère un objet JSON avec EXACTEMENT ces clés :\n" +
    '{"blogTitle": "titre d\'article SEO accrocheur",' +
    '"blogDescription": "meta description 140-160 caractères",' +
    '"emoji": "un emoji pertinent",' +
    '"blogMarkdown": "le corps de l\'article en Markdown, 700-1000 mots, titres H2/H3 (##, ###), intro claire, conseils concrets, et une note rappelant de vérifier prix/horaires",' +
    '"guideOutline": "plan détaillé d\'un guide PDF (jours, budget, logement, transports, checklist) en Markdown",' +
    '"socialPosts": ["3 à 5 courts posts pour réseaux sociaux, avec hashtags"]}';

  const content = await mistralChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.6 }
  );
  return safeParseJson(content);
}

function frontmatter(obj) {
  const esc = (v) => String(v).replace(/"/g, '\\"');
  const lines = Object.entries(obj).map(([k, v]) => {
    if (typeof v === "boolean" || typeof v === "number") return `${k}: ${v}`;
    return `${k}: "${esc(v)}"`;
  });
  return `---\n${lines.join("\n")}\n---\n`;
}

async function writeDraftFiles(idea, data) {
  const slug = slugify(data.blogTitle || idea) || `idee-${Date.now()}`;
  const dir = path.join(DRAFTS_DIR, slug);
  await fs.mkdir(dir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const written = [];

  // 1) Brouillon d'article de blog (prêt à promouvoir dans src/content/blog)
  const blogFm = frontmatter({
    title: data.blogTitle || idea,
    description: data.blogDescription || idea,
    pubDate: today,
    emoji: data.emoji || "📍",
    gradient: "from-brand-500 via-accent-500 to-accent-600",
    readingTime: "7 min",
    draft: true,
  });
  const blogPath = path.join(dir, "blog.md");
  await fs.writeFile(
    blogPath,
    blogFm + "\n" + (data.blogMarkdown || "") + "\n",
    "utf8"
  );
  written.push(path.relative(ROOT, blogPath));

  // 2) Plan de guide
  if (data.guideOutline) {
    const guidePath = path.join(dir, "guide-outline.md");
    await fs.writeFile(
      guidePath,
      `# Plan de guide — ${data.blogTitle || idea}\n\n> Brouillon généré automatiquement. draft: true. À relire avant toute utilisation.\n\n${data.guideOutline}\n`,
      "utf8"
    );
    written.push(path.relative(ROOT, guidePath));
  }

  // 3) Posts réseaux sociaux
  const posts = Array.isArray(data.socialPosts) ? data.socialPosts : [];
  if (posts.length) {
    const socialPath = path.join(dir, "social.md");
    await fs.writeFile(
      socialPath,
      `# Posts social — ${data.blogTitle || idea}\n\n> Brouillon généré automatiquement. draft: true.\n\n` +
        posts.map((p, i) => `## Post ${i + 1}\n\n${p}\n`).join("\n"),
      "utf8"
    );
    written.push(path.relative(ROOT, socialPath));
  }

  return written;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // Lecture des idées
  let ideas = [];
  try {
    const raw = await fs.readFile(IDEAS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    ideas = Array.isArray(parsed) ? parsed : parsed.ideas;
    if (!Array.isArray(ideas) || ideas.length === 0)
      throw new Error("Liste d'idées vide");
  } catch (err) {
    summary.errors.push(`Lecture des idées : ${err.message}`);
    await finish();
    return;
  }
  summary.ideasCount = ideas.length;

  if (!API_KEY) {
    summary.errors.push(
      "MISTRAL_API_KEY absente : scoring et génération ignorés (le build et Discord continuent)."
    );
    await finish();
    return;
  }

  // Étape 2 : scoring
  try {
    summary.scored = await scoreIdeas(ideas);
    summary.mistralUsed = true;
  } catch (err) {
    summary.errors.push(`Scoring : ${err.message}`);
    await finish();
    return;
  }

  // Étape 3 : génération des brouillons pour les meilleures idées
  const top = summary.scored.slice(0, GENERATE_COUNT);
  for (const item of top) {
    try {
      const data = await generateDraftsForIdea(item.idea);
      const files = await writeDraftFiles(item.idea, data);
      summary.generated.push({ idea: item.idea, score: item.score, files });
      summary.generatedFiles.push(...files);
    } catch (err) {
      summary.errors.push(`Génération "${item.idea}" : ${err.message}`);
    }
  }

  await finish();
}

async function finish() {
  summary.finishedAt = new Date().toISOString();
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(
    path.join(OUT_DIR, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );
  // Log lisible dans les logs GitHub Actions
  console.log("=== Résumé automatisation ===");
  console.log(`Idées scorées : ${summary.scored.length}`);
  console.log(`Fichiers générés : ${summary.generatedFiles.length}`);
  console.log(`Erreurs : ${summary.errors.length}`);
  for (const e of summary.errors) console.log(`  - ${e}`);
}

main().catch(async (err) => {
  summary.errors.push(`Erreur inattendue : ${err?.message || err}`);
  await finish();
  // On sort en 0 pour ne pas bloquer le build / la notification.
  process.exit(0);
});
