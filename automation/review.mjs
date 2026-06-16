/**
 * TripPilot Guides — Automatisation V1 : relecture qualité des brouillons.
 *
 * Étapes :
 *  1. Lit automation/output/summary.json (produit par generate.mjs).
 *  2. Regroupe les fichiers générés par dossier de brouillon.
 *  3. Relit blog.md / guide-outline.md / social.md de chaque dossier.
 *  4. Note chaque brouillon sur 10 selon :
 *       - contenu pas trop générique
 *       - CTA présents
 *       - disclaimer prix/horaires présent
 *       - infos incertaines marquées « à vérifier »
 *       - structure H1/H2 propre
 *       - potentiel SEO
 *       - potentiel de vente PDF
 *  5. Écrit automation/output/review.json.
 *  6. Ajoute un champ `review` à summary.json (averageScore, items[], needsImprovementCount).
 *
 * Si MISTRAL_API_KEY est absente (ou en cas d'erreur API), la relecture se fait
 * de façon HEURISTIQUE, sans appel réseau.
 *
 * Le script ne publie rien et ne déplace rien vers src/content.
 * Aucune dépendance externe (fetch natif).
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "automation", "output");
const SUMMARY_FILE = path.join(OUT_DIR, "summary.json");
const REVIEW_FILE = path.join(OUT_DIR, "review.json");

const API_KEY = process.env.MISTRAL_API_KEY;
const MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";
const API_URL = "https://api.mistral.ai/v1/chat/completions";

// Seuils de statut sur 10 :
//   < 8  -> needs_improvement
//   >= 8 -> ok
//   >= 9 -> publish_candidate
const OK_THRESHOLD = 8;
const PUBLISH_THRESHOLD = 9;

function statusFromScore(score) {
  if (score >= PUBLISH_THRESHOLD) return "publish_candidate";
  if (score >= OK_THRESHOLD) return "ok";
  return "needs_improvement";
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

async function readFileSafe(rel) {
  try {
    return await fs.readFile(path.join(ROOT, rel), "utf8");
  } catch {
    return "";
  }
}

function stripFrontmatter(md) {
  const m = md.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? md.slice(m[0].length) : md;
}

function wordCount(s) {
  return (s.trim().match(/\S+/g) || []).length;
}

function uniqueRatio(s) {
  const words = (s.toLowerCase().match(/[a-zà-ÿ]+/g) || []);
  if (!words.length) return 0;
  return new Set(words).size / words.length;
}

/* ---------------- Relecture heuristique (sans API) ---------------- */

function heuristicReview({ blog, guide, social }) {
  const body = stripFrontmatter(blog);
  const all = `${blog}\n${guide}\n${social}`;
  const words = wordCount(body);
  const h2 = (body.match(/^##\s+/gm) || []).length;
  const h1InBody = (body.match(/^#\s+/gm) || []).length;
  const hasTitle = /^---[\s\S]*?\btitle:\s*\S/.test(blog);

  const weaknesses = [];

  // Contenu pas trop générique
  const notGeneric = words >= 600 && h2 >= 3 && uniqueRatio(body) >= 0.3;
  if (!notGeneric)
    weaknesses.push(
      words < 600
        ? "Article trop court (manque de profondeur)."
        : "Contenu potentiellement trop générique."
    );

  // CTA présents (lien checklist / guide / verbes d'action)
  const ctaPresent =
    /(checklist|\/guides|guide pdf|télécharge|télécharger|acheter|découvrir le guide)/i.test(
      all
    );
  if (!ctaPresent) weaknesses.push("Aucun appel à l'action (checklist / guide) détecté.");

  // Disclaimer prix/horaires
  const disclaimerPresent =
    /(prix\s+et\s+horaires|peuvent\s+évoluer|prix.{0,40}(chang|évolu)|horaires.{0,40}(chang|évolu))/i.test(
      all
    );
  if (!disclaimerPresent)
    weaknesses.push("Disclaimer prix/horaires manquant.");

  // Infos incertaines marquées à vérifier
  const uncertaintyMarked =
    /(à\s+vérifier|vérifie[rz]|indicatif|peu(t|vent)\s+varier|avant\s+(votre|ton)\s+départ)/i.test(
      all
    );
  if (!uncertaintyMarked)
    weaknesses.push("Aucune mention « à vérifier » pour les infos incertaines.");

  // Structure H1/H2 propre : titre en frontmatter (H1), pas de # dans le corps, >= 2 H2
  const headingStructure = hasTitle && h1InBody === 0 && h2 >= 2;
  if (!headingStructure) {
    if (!hasTitle) weaknesses.push("Titre (frontmatter) manquant.");
    else if (h1InBody > 0)
      weaknesses.push("H1 en double dans le corps (utiliser ## pour les sections).");
    else weaknesses.push("Pas assez de sous-titres H2.");
  }

  // Potentiel SEO (0-10)
  let seoPotential = 0;
  seoPotential += Math.min(5, words / 200); // ~1000 mots => 5
  seoPotential += Math.min(3, h2); // jusqu'à 3
  seoPotential += /\bdescription:\s*\S/.test(blog) ? 2 : 0;
  seoPotential = Math.min(10, round1(seoPotential));

  // Potentiel de vente PDF (0-10)
  let pdfSalesPotential = 0;
  pdfSalesPotential += guide && wordCount(guide) > 80 ? 4 : 0;
  pdfSalesPotential += /(budget|itinéraire|jour\s*1|checklist)/i.test(all) ? 3 : 0;
  pdfSalesPotential += ctaPresent ? 3 : 0;
  pdfSalesPotential = Math.min(10, round1(pdfSalesPotential));

  // Score global /10
  let score = 0;
  score += notGeneric ? 2 : 0;
  score += ctaPresent ? 1.5 : 0;
  score += disclaimerPresent ? 1.5 : 0;
  score += uncertaintyMarked ? 1 : 0;
  score += headingStructure ? 1.5 : 0;
  score += (seoPotential / 10) * 1.25;
  score += (pdfSalesPotential / 10) * 1.25;
  score = Math.min(10, round1(score));

  return {
    score,
    checks: {
      notGeneric,
      ctaPresent,
      disclaimerPresent,
      uncertaintyMarked,
      headingStructure,
      seoPotential,
      pdfSalesPotential,
    },
    weaknesses,
  };
}

/* ---------------- Relecture Mistral (avec API) ---------------- */

async function mistralReview({ blog, guide, social }) {
  const system =
    "Tu es éditeur en chef pour une marque française de guides de voyage PDF. " +
    "Tu relis des brouillons et tu notes leur qualité de façon exigeante. " +
    "Réponds STRICTEMENT en JSON.";
  const user =
    "Évalue ce brouillon et renvoie un objet JSON :\n" +
    '{"score":0-10,"notGeneric":bool,"ctaPresent":bool,"disclaimerPresent":bool,' +
    '"uncertaintyMarked":bool,"headingStructure":bool,"seoPotential":0-10,' +
    '"pdfSalesPotential":0-10,"weaknesses":["points faibles courts en français"]}\n\n' +
    "Critères : contenu pas trop générique, CTA présents (checklist/guide), " +
    "disclaimer prix/horaires, infos incertaines marquées à vérifier, structure " +
    "H1/H2 propre, potentiel SEO, potentiel de vente d'un guide PDF.\n\n" +
    "=== BLOG.md ===\n" +
    blog.slice(0, 3500) +
    "\n\n=== GUIDE-OUTLINE.md ===\n" +
    guide.slice(0, 1500) +
    "\n\n=== SOCIAL.md ===\n" +
    social.slice(0, 1000);

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Mistral HTTP ${res.status} — ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Réponse Mistral vide");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("JSON review non parsable");
    parsed = JSON.parse(m[0]);
  }
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    score: Math.min(10, Math.max(0, round1(num(parsed.score)))),
    checks: {
      notGeneric: !!parsed.notGeneric,
      ctaPresent: !!parsed.ctaPresent,
      disclaimerPresent: !!parsed.disclaimerPresent,
      uncertaintyMarked: !!parsed.uncertaintyMarked,
      headingStructure: !!parsed.headingStructure,
      seoPotential: Math.min(10, Math.max(0, round1(num(parsed.seoPotential)))),
      pdfSalesPotential: Math.min(
        10,
        Math.max(0, round1(num(parsed.pdfSalesPotential)))
      ),
    },
    weaknesses: Array.isArray(parsed.weaknesses)
      ? parsed.weaknesses.map((w) => String(w)).slice(0, 6)
      : [],
  };
}

/* ---------------- Pénalité d'usage de la recherche ---------------- */

/**
 * Pénalise fortement un brouillon qui n'exploite pas les données de recherche,
 * et vérifie la présence de sources et de liens/points « à vérifier ».
 */
function applyResearchChecks(result, { blog, guide }, gen) {
  const all = `${blog}\n${guide}`;
  const sourcesPresent =
    (gen?.sourcesCount || 0) > 0 || /##\s*Sources[\s\S]*\]\(https?:\/\//i.test(all);
  const verifyPresent = /à\s+vérifier/i.test(all);
  // « recherche utilisée » = generate a consommé un dossier research ET le
  // brouillon reflète les points à vérifier.
  const researchUsed = !!gen?.researchUsed && verifyPresent;

  let score = result.score;
  const weaknesses = [...result.weaknesses];

  if (!researchUsed) {
    score = Math.min(score, 4); // pénalité forte
    weaknesses.unshift(
      "Aucune donnée de recherche utilisée : fiabilité non démontrée (ni sources ni « à vérifier »)."
    );
  }
  if (!sourcesPresent) {
    score = Math.max(0, score - 1.5);
    weaknesses.push("Aucune source vérifiable citée.");
  }
  if (!verifyPresent) {
    score = Math.max(0, score - 1);
    weaknesses.push("Encadré / liens « à vérifier » absents.");
  }

  return {
    score: round1(score),
    checks: {
      ...result.checks,
      researchUsed,
      sourcesPresent,
      verifyLinksPresent: verifyPresent,
    },
    weaknesses: weaknesses.slice(0, 8),
  };
}

/* ---------------- Orchestration ---------------- */

function groupByDraft(generatedFiles) {
  const map = new Map();
  for (const f of generatedFiles) {
    const dir = path.posix.dirname(f.split(path.sep).join("/"));
    if (!map.has(dir)) map.set(dir, []);
    map.get(dir).push(f);
  }
  return map;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  /** @type {any} */
  let summary = null;
  try {
    summary = JSON.parse(await fs.readFile(SUMMARY_FILE, "utf8"));
  } catch {
    summary = {
      errors: ["review : summary.json introuvable (generate.mjs non exécuté ?)"],
      generatedFiles: [],
    };
  }

  const generatedFiles = Array.isArray(summary.generatedFiles)
    ? summary.generatedFiles
    : [];
  const generatedBySlug = new Map(
    (Array.isArray(summary.generated) ? summary.generated : []).map((g) => [g.slug, g])
  );
  const useMistral = !!API_KEY;

  const review = {
    reviewedAt: new Date().toISOString(),
    method: useMistral ? "mistral" : "heuristic",
    averageScore: 0,
    needsImprovementCount: 0,
    items: [],
    errors: [],
  };

  const groups = groupByDraft(generatedFiles);

  for (const [dir, files] of groups) {
    const blog = await readFileSafe(
      files.find((f) => f.endsWith("blog.md")) || `${dir}/blog.md`
    );
    const guide = await readFileSafe(
      files.find((f) => f.endsWith("guide-outline.md")) || `${dir}/guide-outline.md`
    );
    const social = await readFileSafe(
      files.find((f) => f.endsWith("social.md")) || `${dir}/social.md`
    );

    let result;
    if (useMistral) {
      try {
        result = await mistralReview({ blog, guide, social });
      } catch (err) {
        review.errors.push(`Review IA "${dir}" : ${err.message} (repli heuristique)`);
        result = heuristicReview({ blog, guide, social });
      }
    } else {
      result = heuristicReview({ blog, guide, social });
    }

    // Pénalité forte si la recherche n'est pas exploitée + contrôle sources/à vérifier
    const gen = generatedBySlug.get(path.posix.basename(dir));
    result = applyResearchChecks(result, { blog, guide }, gen);

    const status = statusFromScore(result.score);
    if (status === "needs_improvement") review.needsImprovementCount++;

    review.items.push({
      draft: dir,
      slug: path.posix.basename(dir),
      score: result.score,
      status,
      checks: result.checks,
      weaknesses: result.weaknesses,
      files,
    });
  }

  // Trie par score décroissant
  review.items.sort((a, b) => b.score - a.score);
  review.averageScore = review.items.length
    ? round1(
        review.items.reduce((s, i) => s + i.score, 0) / review.items.length
      )
    : 0;
  review.publishCandidateCount = review.items.filter(
    (i) => i.status === "publish_candidate"
  ).length;

  await fs.writeFile(REVIEW_FILE, JSON.stringify(review, null, 2), "utf8");

  // Mise à jour de summary.json avec un champ `review` compact
  summary.review = {
    method: review.method,
    averageScore: review.averageScore,
    needsImprovementCount: review.needsImprovementCount,
    publishCandidateCount: review.publishCandidateCount,
    items: review.items.map((i) => ({
      slug: i.slug,
      draft: i.draft,
      score: i.score,
      status: i.status,
      weaknesses: i.weaknesses.slice(0, 3),
    })),
  };
  if (review.errors.length) {
    summary.errors = [...(summary.errors || []), ...review.errors];
  }
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log("=== Review brouillons ===");
  console.log(`Méthode : ${review.method}`);
  console.log(`Brouillons évalués : ${review.items.length}`);
  console.log(`Score moyen : ${review.averageScore}/10`);
  console.log(`Candidats à la publication (>=9) : ${review.publishCandidateCount}`);
  console.log(`À améliorer (<8) : ${review.needsImprovementCount}`);
  for (const i of review.items) {
    console.log(`  - ${i.slug} : ${i.score}/10 (${i.status})`);
  }
}

main().catch(async (err) => {
  console.error("Erreur review :", err?.message || err);
  // Ne bloque pas le pipeline (build + notify doivent continuer).
  try {
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(
      REVIEW_FILE,
      JSON.stringify(
        { error: String(err?.message || err), items: [], averageScore: 0, needsImprovementCount: 0 },
        null,
        2
      ),
      "utf8"
    );
  } catch {}
  process.exit(0);
});
