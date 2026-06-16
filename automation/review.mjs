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

/* ---------------- Checks déterministes (prioritaires) ---------------- */

function deterministicChecks(blog, guide, social) {
  const body = stripFrontmatter(blog);
  const all = `${blog}\n${guide}\n${social}`;
  const words = wordCount(body);
  const h2 = (body.match(/^##\s+/gm) || []).length;
  const h1InBody = (body.match(/^#\s+/gm) || []).length;
  const hasTitle = /^---[\s\S]*?\btitle:\s*\S/.test(blog);

  const ctaChecklist = /checklist gratuite/i.test(all) || /téléchargez/i.test(all);
  const ctaGuide = /guide pdf complet/i.test(all);
  const ctaPresent = ctaChecklist && ctaGuide;
  const disclaimerPresent =
    /prix et horaires peuvent évoluer/i.test(all) || /vérifiez toujours/i.test(all);
  const sourcesPresent = /^##\s*sources/im.test(all);
  const needsVerificationPresent =
    /à\s+vérifier avant le départ/i.test(all) || /à\s+vérifier/i.test(all);
  const notGeneric = words >= 600 && h2 >= 3 && uniqueRatio(body) >= 0.3;
  const headingStructure = hasTitle && h1InBody === 0 && h2 >= 2;

  return {
    words,
    h2,
    ctaChecklist,
    ctaGuide,
    ctaPresent,
    disclaimerPresent,
    sourcesPresent,
    needsVerificationPresent,
    notGeneric,
    headingStructure,
  };
}

function heuristicSubjective(checks, guide) {
  let seo = 0;
  seo += Math.min(5, checks.words / 200);
  seo += Math.min(3, checks.h2);
  seo += checks.sourcesPresent ? 2 : 0;
  const guideWords = wordCount(guide);
  let pdf = 0;
  pdf += guideWords > 120 ? 4 : guideWords > 40 ? 2 : 0;
  pdf += /budget|itinéraire|checklist/i.test(guide) ? 3 : 0;
  pdf += checks.ctaPresent ? 3 : 0;
  return {
    seoPotential: Math.min(10, round1(seo)),
    pdfSalesPotential: Math.min(10, round1(pdf)),
  };
}

function scoreFrom(c, seoPotential, pdfSalesPotential) {
  let s = 0;
  s += c.notGeneric ? 2 : 0;
  s += c.ctaPresent ? 1.5 : 0;
  s += c.disclaimerPresent ? 1.5 : 0;
  s += c.needsVerificationPresent ? 1 : 0;
  s += c.headingStructure ? 1.5 : 0;
  s += (seoPotential / 10) * 1.25;
  s += (pdfSalesPotential / 10) * 1.25;
  return Math.min(10, round1(s));
}

function deterministicWeaknesses(c) {
  const w = [];
  if (!c.notGeneric)
    w.push(c.words < 600 ? "Article trop court (manque de profondeur)." : "Contenu peut-être trop générique.");
  if (!c.ctaChecklist) w.push("CTA checklist gratuite manquant.");
  if (!c.ctaGuide) w.push("CTA guide PDF complet manquant.");
  if (!c.disclaimerPresent) w.push("Disclaimer prix/horaires manquant.");
  if (!c.needsVerificationPresent) w.push("Section « à vérifier » absente.");
  if (!c.headingStructure) w.push("Structure de titres (H1/H2) à revoir.");
  if (!c.sourcesPresent) w.push("Section Sources absente.");
  return w;
}

/* ---------------- Détection de contenu tronqué ---------------- */

const BLOG_MARKER = "TRIPILOT_COMPLETE_BLOG";
const GUIDE_MARKER = "TRIPILOT_COMPLETE_GUIDE";

/** Détecte un contenu coupé au milieu (phrase, gras, parenthèse, section vide…). */
function isTruncated(raw) {
  if (!raw) return true;
  // Retire les marqueurs HTML et les espaces de fin
  let t = raw.replace(/<!--[\s\S]*?-->/g, "").replace(/[\s]+$/g, "");
  if (!t.trim()) return true;

  // Gras Markdown non fermé (nombre impair de **)
  if (((t.match(/\*\*/g) || []).length) % 2 !== 0) return true;
  // Parenthèses ouvertes non refermées
  if ((t.match(/\(/g) || []).length > (t.match(/\)/g) || []).length) return true;

  const lines = t.split(/\n/).map((l) => l.replace(/\s+$/g, "")).filter((l) => l.length > 0);
  const last = lines[lines.length - 1] || "";

  // Ligne finissant par un caractère qui annonce une suite
  if (/[-:(]$/.test(last)) return true;
  if (/\bart$/i.test(last)) return true;
  if (/\*\*$/.test(last)) return true;
  // Titre/section commencé mais non suivi de contenu (dernier élément = heading)
  if (/^#{1,6}\s+\S/.test(last)) return true;

  // Lignes "douces" (fin acceptable sans ponctuation) : citation, liste, checkbox, tableau
  const soft =
    /^>/.test(last) ||
    /^\s*([-*]|\d+[.)])\s/.test(last) ||
    last.includes("|");
  if (!soft) {
    // Paragraphe normal : doit se terminer par une ponctuation de fin
    if (!/[.!?…»)\]"']$/.test(last)) return true;
  }
  return false;
}

/** Supprime les faiblesses IA en contradiction avec un check déterministe positif. */
function filterContradictoryWeaknesses(weaknesses, checks) {
  const seen = new Set();
  return weaknesses.filter((w) => {
    const l = (w || "").toLowerCase();
    if (!l || seen.has(l)) return false;
    seen.add(l);
    // CTA présents (les deux) -> retirer les "pas de CTA"
    if (
      checks.ctaPresent &&
      /(pas de cta|aucun cta|sans cta|absence de cta|call to action|cta\b.*(manqu|absent))/.test(l)
    )
      return false;
    // Disclaimer présent -> retirer les "pas de disclaimer"
    if (
      checks.disclaimerPresent &&
      /(disclaimer|avertissement|mention légale).*(manqu|absent)|aucun disclaimer|pas de disclaimer/.test(l)
    )
      return false;
    // "à vérifier" présent -> retirer les "infos incertaines non marquées"
    if (
      checks.needsVerificationPresent &&
      /(incertain|à vérifier|a verifier).*(non|absent|manqu|pas)|aucune mention.*vérif/.test(l)
    )
      return false;
    return true;
  });
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

    // 1) Checks déterministes (prioritaires) + potentiels heuristiques
    const det = deterministicChecks(blog, guide, social);
    const heur = heuristicSubjective(det, guide);
    let seo = heur.seoPotential;
    let pdf = heur.pdfSalesPotential;
    let iaChecks = {};
    let iaWeak = [];

    // 2) La review IA complète (potentiels + faiblesses), sans écraser un check déterministe positif
    if (useMistral) {
      try {
        const ia = await mistralReview({ blog, guide, social });
        seo = ia.checks.seoPotential;
        pdf = ia.checks.pdfSalesPotential;
        iaChecks = ia.checks;
        iaWeak = ia.weaknesses || [];
      } catch (err) {
        review.errors.push(`Review IA "${dir}" : ${err.message} (repli heuristique)`);
      }
    }

    const checks = {
      notGeneric: det.notGeneric || !!iaChecks.notGeneric,
      ctaPresent: det.ctaPresent,
      ctaChecklist: det.ctaChecklist,
      ctaGuide: det.ctaGuide,
      disclaimerPresent: det.disclaimerPresent || !!iaChecks.disclaimerPresent,
      needsVerificationPresent: det.needsVerificationPresent || !!iaChecks.uncertaintyMarked,
      headingStructure: det.headingStructure || !!iaChecks.headingStructure,
      sourcesPresent: det.sourcesPresent,
      seoPotential: seo,
      pdfSalesPotential: pdf,
    };

    let result = {
      score: scoreFrom(checks, seo, pdf),
      checks,
      weaknesses: [...deterministicWeaknesses(checks), ...iaWeak],
    };

    // 3) Complétude des fichiers du brouillon
    const hasBlog = blog.trim().length > 0;
    const hasGuide = guide.trim().length > 0;
    const hasSocial = social.trim().length > 0;
    const socialBroken = /\[object Object\]/.test(social);
    const missingFiles = [];
    if (!hasBlog) missingFiles.push("blog.md");
    if (!hasGuide) missingFiles.push("guide-outline.md");
    if (!hasSocial) missingFiles.push("social.md");
    const complete = hasBlog && hasGuide && hasSocial && !socialBroken;
    if (socialBroken) result.weaknesses.push("social.md contient [object Object].");
    if (missingFiles.length)
      result.weaknesses.push(`Brouillon incomplet (manque : ${missingFiles.join(", ")}).`);

    // 4) Pénalité forte si la recherche n'est pas exploitée + contrôle sources/à vérifier
    const gen = generatedBySlug.get(path.posix.basename(dir));
    result = applyResearchChecks(result, { blog, guide }, gen);

    // 5) Détection de troncature / incomplétude (heuristique + marqueurs de complétude)
    const blogMarkerOk = blog.includes(BLOG_MARKER);
    const guideMarkerOk = guide.includes(GUIDE_MARKER);
    const markersOk = blogMarkerOk && guideMarkerOk;
    const blogTruncated = isTruncated(blog) || !blogMarkerOk;
    const guideTruncated = isTruncated(guide) || !guideMarkerOk;
    const truncated = blogTruncated || guideTruncated;
    if (truncated) {
      result.score = Math.min(result.score, 7);
      result.weaknesses.unshift("Contenu tronqué ou incomplet.");
    }

    // 6) Faiblesses : retirer les contradictions avec les checks déterministes
    result.weaknesses = filterContradictoryWeaknesses(result.weaknesses, result.checks).slice(0, 8);

    // 7) Statut : publish_candidate refusé si marqueurs absents (déjà plafonné à 7 si tronqué)
    let status = statusFromScore(result.score);
    if (status === "publish_candidate" && !markersOk) status = "ok";
    if (status === "needs_improvement") review.needsImprovementCount++;

    review.items.push({
      draft: dir,
      slug: path.posix.basename(dir),
      score: result.score,
      status,
      checks: { ...result.checks, truncated, markersOk },
      weaknesses: result.weaknesses,
      complete,
      missingFiles,
      socialBroken,
      truncated,
      markersOk,
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
      complete: i.complete,
      missingFiles: i.missingFiles,
      socialBroken: i.socialBroken,
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
