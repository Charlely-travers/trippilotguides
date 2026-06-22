/**
 * TripPilot Guides — Automatisation V1 : recherche web structurée (avant génération).
 *
 * Pour chaque idée sélectionnée, produit un dossier de recherche structuré qui
 * servira de base factuelle à la génération des brouillons.
 *
 * Architecture à 3 niveaux (repli automatique, ne casse jamais le workflow) :
 *   1. web_search  : Mistral Conversations API (beta) + outil `web_search`
 *                    -> POST /v1/conversations { tools:[{type:"web_search"}] }
 *                    -> sources réelles via les chunks `tool_reference`.
 *   2. model_only  : si web_search indisponible/échoue mais clé présente,
 *                    recherche basée sur le modèle (TOUT est marqué à vérifier).
 *   3. offline     : sans clé API, squelette de recherche à compléter à la main.
 *
 * Sortie : automation/research/<slug>.json (un fichier par idée).
 * Met à jour automation/output/summary.json (scored[], research{...}, errors[]).
 *
 * Ne publie rien, ne déplace rien vers src/content. Aucune dépendance externe.
 */

import "./lib/load-env.mjs";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const IDEAS_FILE = path.join(ROOT, "automation", "ideas.json");
const RESEARCH_DIR = path.join(ROOT, "automation", "research");
const OUT_DIR = path.join(ROOT, "automation", "output");
const SUMMARY_FILE = path.join(OUT_DIR, "summary.json");

const API_KEY = process.env.MISTRAL_API_KEY;
const MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";
const RESEARCH_MODEL = process.env.MISTRAL_RESEARCH_MODEL || MODEL;
const GENERATE_COUNT = Math.max(
  1,
  Math.min(5, parseInt(process.env.GENERATE_COUNT || "1", 10) || 1)
);
// Cible explicite (passée par le bot Discord via l'input du workflow).
// Si présente, on ne traite QUE cette ville (pas de sélection par score).
const TARGET_IDEA = (process.env.TARGET_IDEA || "").trim();

const CHAT_URL = "https://api.mistral.ai/v1/chat/completions";
const CONVERSATIONS_URL = "https://api.mistral.ai/v1/conversations";

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
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("JSON non parsable");
  }
}

function guessDestination(idea) {
  const m = idea.match(/^([A-ZÀ-Ÿ][\p{L}'’ -]+?)\s+(?:en|le|la|pour|à|:|\d)/u);
  return (m ? m[1] : idea.split(/[,:]/)[0]).trim();
}

/** Chat completions classique (scoring + repli model_only). */
async function mistralChat(messages, { temperature = 0.3, maxTokens, json = true } = {}) {
  const res = await fetch(CHAT_URL, {
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
    const t = await res.text().catch(() => "");
    throw new Error(`chat HTTP ${res.status} — ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const c = data?.choices?.[0]?.message?.content;
  if (!c) throw new Error("réponse chat vide");
  return c;
}

/** Conversations API (beta) avec l'outil web_search. */
async function conversationsWebSearch(prompt) {
  const res = await fetch(CONVERSATIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: RESEARCH_MODEL,
      inputs: prompt,
      tools: [{ type: "web_search" }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`conversations HTTP ${res.status} — ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return extractFromConversation(data);
}

/** Extrait le texte assistant et les sources (tool_reference) d'une réponse Conversations. */
function extractFromConversation(data) {
  let text = "";
  const refs = [];
  const outputs = Array.isArray(data?.outputs) ? data.outputs : [];
  for (const o of outputs) {
    const content = o?.content;
    if (typeof content === "string") {
      text += content + "\n";
    } else if (Array.isArray(content)) {
      for (const chunk of content) {
        if (chunk?.type === "text" && chunk.text) text += chunk.text;
        else if (
          (chunk?.type === "tool_reference" || chunk?.type === "reference") &&
          chunk?.url
        ) {
          refs.push({ title: String(chunk.title || chunk.url), url: String(chunk.url) });
        }
      }
    }
  }
  return { text, refs };
}

const RESEARCH_SCHEMA_HINT =
  "Renvoie UNIQUEMENT un objet JSON valide avec ces clés : " +
  '{"destination": string, "angle": string, ' +
  '"sources": [{"title": string, "url": string}], ' +
  '"attractions": [{"name": string, "priceIndicatif": string, "url": string}], ' +
  '"transports": [string], "neighborhoods": [string], ' +
  '"restaurants": [string], "attentionPoints": [string], ' +
  '"keywords": [string], "needsVerification": [string]}. ' +
  "N'invente pas de prix ni d'URL : si une info n'est pas vérifiée, laisse le champ vide " +
  "et ajoute-la dans needsVerification.";

function normalizeResearch(idea, parsed, method, extraSources = []) {
  const asArr = (v) => (Array.isArray(v) ? v : []);
  const sources = [
    ...asArr(parsed?.sources).map((s) => ({
      title: String(s?.title || s?.url || "").trim(),
      url: String(s?.url || "").trim(),
    })),
    ...extraSources,
  ].filter((s) => s.url);
  // Déduplique par URL
  const seen = new Set();
  const dedupSources = sources.filter((s) =>
    seen.has(s.url) ? false : (seen.add(s.url), true)
  );

  return {
    idea,
    destination: String(parsed?.destination || guessDestination(idea)).trim(),
    angle: String(parsed?.angle || "").trim(),
    method,
    generatedAt: new Date().toISOString(),
    sources: dedupSources,
    attractions: asArr(parsed?.attractions).map((a) => ({
      name: String(a?.name || "").trim(),
      priceIndicatif: String(a?.priceIndicatif || "").trim(),
      url: String(a?.url || "").trim(),
    })),
    transports: asArr(parsed?.transports).map(String),
    neighborhoods: asArr(parsed?.neighborhoods).map(String),
    restaurants: asArr(parsed?.restaurants).map(String),
    attentionPoints: asArr(parsed?.attentionPoints).map(String),
    keywords: asArr(parsed?.keywords).map(String),
    needsVerification: asArr(parsed?.needsVerification).map(String),
  };
}

/** Slugs des villes déjà publiées (guide présent dans src/content/guides). */
async function listPublishedSlugs() {
  const dir = path.join(ROOT, "src", "content", "guides");
  try {
    const files = await fs.readdir(dir);
    return new Set(
      files
        .filter((f) => f.endsWith(".md") && !f.startsWith("_") && f !== ".gitkeep")
        .map((f) => f.replace(/\.md$/, ""))
    );
  } catch {
    return new Set();
  }
}

function offlineResearch(idea) {
  return normalizeResearch(
    idea,
    {
      destination: guessDestination(idea),
      angle: idea,
      needsVerification: [
        "Prix et tarifs des attractions",
        "Horaires d'ouverture",
        "Coûts et options de transport",
        "Disponibilité et prix des hébergements",
        "Adresses et ouverture des restaurants",
        "Conditions d'accès (réservations, billets)",
      ],
    },
    "offline"
  );
}

/** Recherche pour une idée : web_search -> model_only -> offline. */
async function researchIdea(idea, summary) {
  if (!API_KEY) return offlineResearch(idea);

  const prompt =
    `Recherche des informations FIABLES et RÉCENTES pour préparer un contenu de voyage sur : "${idea}".\n` +
    "Cherche sur le web : attractions principales (avec prix indicatifs et URL officielle si possible), " +
    "transports (aéroport et sur place), quartiers où dormir, restaurants/types d'adresses, points d'attention, " +
    "et mots-clés/tendances SEO ou Pinterest. Cite tes sources.\n\n" +
    RESEARCH_SCHEMA_HINT;

  // Niveau 1 : web_search
  try {
    const { text, refs } = await conversationsWebSearch(prompt);
    const parsed = safeParseJson(text);
    const research = normalizeResearch(idea, parsed, "web_search", refs);
    if (research.needsVerification.length === 0) {
      research.needsVerification.push(
        "Vérifier prix, horaires et conditions d'accès avant publication."
      );
    }
    return research;
  } catch (err) {
    summary.errors.push(`web_search "${idea}" : ${err.message} (repli modèle)`);
  }

  // Niveau 2 : model_only (sans web, tout à vérifier)
  try {
    const content = await mistralChat(
      [
        {
          role: "system",
          content:
            "Tu es documentaliste voyage. Tu n'as PAS accès au web : tes informations " +
            "sont approximatives et DOIVENT toutes être vérifiées. Réponds STRICTEMENT en JSON.",
        },
        {
          role: "user",
          content:
            `Sujet : "${idea}".\n` +
            RESEARCH_SCHEMA_HINT +
            " Laisse sources vide et liste TOUT ce qui doit être vérifié dans needsVerification.",
        },
      ],
      { temperature: 0.3, maxTokens: 1500 }
    );
    const parsed = safeParseJson(content);
    const research = normalizeResearch(idea, parsed, "model_only");
    research.needsVerification.unshift(
      "⚠️ Données issues du modèle sans recherche web : tout vérifier (prix, horaires, adresses, URLs)."
    );
    return research;
  } catch (err) {
    summary.errors.push(`model_only "${idea}" : ${err.message} (repli hors-ligne)`);
  }

  // Niveau 3 : offline
  return offlineResearch(idea);
}

/** Scoring des idées pour sélectionner les meilleures (API ou ordre par défaut). */
async function scoreIdeas(ideas, summary) {
  if (!API_KEY) {
    return ideas.map((idea, i) => ({ idea, score: 0, raison: "non scoré (hors-ligne)", rank: i }));
  }
  try {
    const content = await mistralChat([
      {
        role: "system",
        content:
          "Tu es stratège contenu SEO pour une marque de guides de voyage PDF. " +
          "Tu notes des idées de 0 à 100 (SEO, monétisation, facilité). Réponds STRICTEMENT en JSON.",
      },
      {
        role: "user",
        content:
          'Note chaque idée. Renvoie {"results":[{"idea":string,"score":0-100,"raison":string}]}.\n' +
          ideas.map((i, n) => `${n + 1}. ${i}`).join("\n"),
      },
    ]);
    const parsed = safeParseJson(content);
    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    return results
      .map((r) => ({
        idea: String(r.idea || "").trim(),
        score: Number(r.score) || 0,
        raison: String(r.raison || "").trim(),
      }))
      .filter((r) => r.idea)
      .sort((a, b) => b.score - a.score);
  } catch (err) {
    summary.errors.push(`Scoring : ${err.message} (ordre par défaut)`);
    return ideas.map((idea) => ({ idea, score: 0, raison: "scoring indisponible" }));
  }
}

async function main() {
  await fs.mkdir(RESEARCH_DIR, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const summary = {
    startedAt: new Date().toISOString(),
    model: MODEL,
    researchModel: RESEARCH_MODEL,
    scored: [],
    research: { method: API_KEY ? "api" : "offline", requested: 0, succeeded: 0, totalSources: 0, items: [] },
    generated: [],
    generatedFiles: [],
    errors: [],
  };

  // Lecture des idées
  let ideas = [];
  try {
    const parsed = JSON.parse(await fs.readFile(IDEAS_FILE, "utf8"));
    ideas = Array.isArray(parsed) ? parsed : parsed.ideas;
    if (!Array.isArray(ideas) || ideas.length === 0) throw new Error("liste vide");
  } catch (err) {
    summary.errors.push(`Lecture des idées : ${err.message}`);
    await writeSummary(summary);
    return;
  }
  summary.ideasCount = ideas.length;

  // Sélection des idées à traiter.
  let selected;
  if (TARGET_IDEA) {
    // Cible explicite (Discord) : on ne traite QUE cette ville.
    const matches = ideas.filter((i) =>
      i.toLowerCase().includes(TARGET_IDEA.toLowerCase())
    );
    const ideaList = matches.length ? matches : [TARGET_IDEA];
    summary.scored = await scoreIdeas(ideaList, summary);
    if (!summary.scored.length) {
      summary.scored = ideaList.map((idea) => ({ idea, score: 0, raison: "cible explicite" }));
    }
    selected = summary.scored.slice(0, GENERATE_COUNT);
    summary.target = TARGET_IDEA;
  } else {
    // Pas de cible : on ignore les villes déjà publiées, puis on prend les mieux notées.
    const published = await listPublishedSlugs();
    const freshIdeas = ideas.filter(
      (i) => !published.has(slugify(guessDestination(i)))
    );
    const pool = freshIdeas.length ? freshIdeas : ideas;
    summary.scored = await scoreIdeas(pool, summary);
    if (!summary.scored.length) {
      summary.scored = pool.map((idea) => ({ idea, score: 0, raison: "non scoré" }));
    }
    selected = summary.scored.slice(0, GENERATE_COUNT);
  }
  summary.research.requested = selected.length;

  // Recherche par idée
  for (const item of selected) {
    const research = await researchIdea(item.idea, summary);
    const slug = slugify(research.destination || item.idea) || `idee-${Date.now()}`;
    const file = path.relative(ROOT, path.join(RESEARCH_DIR, `${slug}.json`));
    await fs.writeFile(path.join(ROOT, file), JSON.stringify(research, null, 2), "utf8");

    if (research.method !== "offline") summary.research.succeeded++;
    summary.research.totalSources += research.sources.length;
    summary.research.items.push({
      slug,
      idea: item.idea,
      method: research.method,
      sources: research.sources.length,
      needsVerification: research.needsVerification.length,
      file,
    });
  }

  await writeSummary(summary);
  console.log("=== Recherche ===");
  console.log(`Méthode globale : ${summary.research.method}`);
  console.log(`Idées recherchées : ${summary.research.requested}`);
  console.log(`Réussies (web/modèle) : ${summary.research.succeeded}`);
  console.log(`Sources totales : ${summary.research.totalSources}`);
  for (const it of summary.research.items)
    console.log(`  - ${it.slug} [${it.method}] : ${it.sources} source(s)`);
}

async function writeSummary(summary) {
  summary.finishedAt = new Date().toISOString();
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
}

main().catch(async (err) => {
  console.error("Erreur research :", err?.message || err);
  process.exit(0); // ne bloque pas la suite du pipeline
});
