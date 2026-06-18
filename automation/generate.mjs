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

import "./lib/load-env.mjs";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const RESEARCH_DIR = path.join(ROOT, "automation", "research");
const OUT_DIR = path.join(ROOT, "automation", "output");
const SUMMARY_FILE = path.join(OUT_DIR, "summary.json");
const DRAFTS_DIR = path.join(ROOT, "automation", "drafts");

const API_KEY = process.env.MISTRAL_API_KEY;
const MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";
const GUIDE_MODEL = process.env.MISTRAL_GUIDE_MODEL || MODEL;
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

/** Détecte la durée (nb de jours) à partir de l'idée. 0 si inconnu. */
function parseDays(idea) {
  const m = String(idea || "").match(/(\d+)\s*jours?/i);
  const n = m ? parseInt(m[1], 10) : 0;
  return n > 0 && n <= 14 ? n : 0;
}

async function mistralChatFull(messages, { json = true, temperature = 0.4, maxTokens, model } = {}) {
  if (!API_KEY) throw new Error("MISTRAL_API_KEY manquante");
  const useModel = model || MODEL;
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: useModel,
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
            "Tu génères des métadonnées SEO en français pour un blog voyage premium. " +
            "Les titres doivent être accrocheurs et spécifiques (avec chiffres, durée, budget si pertinent). " +
            "Les descriptions doivent donner envie de cliquer. Réponds STRICTEMENT en JSON.",
        },
        {
          role: "user",
          content:
            `Sujet : "${research.idea}" (destination : ${research.destination}).\n` +
            "Renvoie {\"title\": string (50-70 car., accrocheur avec chiffre ou angle précis), " +
            "\"description\": string (140-160 car., qui donne envie de lire l'article)}.",
        },
      ],
      { temperature: 0.5, maxTokens: 300 }
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

/** Nettoie un Markdown (retire un éventuel bloc de code englobant + titres mal formés). */
function cleanMarkdown(content) {
  return fixDayOverviewLines(
    normalizeHeadings(
      content
        .trim()
        .replace(/^```(?:markdown)?\s*/i, "")
        .replace(/```$/i, "")
        .trim()
    )
  );
}

/**
 * Corrige les titres mal formés par le modèle :
 * "### ### Jour 1" -> "### Jour 1" (dièses répétés en début de ligne).
 */
function normalizeHeadings(md) {
  return String(md || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(#{1,6})\s+(?:#{1,6}\s+)+/, "$1 "))
    .join("\n");
}

/**
 * Transforme les lignes d'aperçu "**Jour 1** — ..." en éléments de liste à puces.
 * Sans ça, des lignes consécutives sans ligne vide sont fusionnées en un seul paragraphe.
 * Ne touche pas aux titres (### Jour 1) ni aux lignes déjà en liste.
 */
function fixDayOverviewLines(md) {
  return String(md || "")
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*(#{1,6}|[-*]|\d+[.)])\s/.test(line)) return line; // titre / liste : on laisse
      if (/^\s*\*\*Jour\s*\d+\*\*/i.test(line)) return `- ${line.trim()}`;
      return line;
    })
    .join("\n");
}

/** Itinéraire court (fallback blog), conscient de la durée. */
function shortItinerary(research) {
  const days = parseDays(research.idea) || (research.attractions?.length ? Math.min(research.attractions.length, 4) : 3);
  const attractions = research.attractions?.length ? research.attractions : [];
  const dest = research.destination || "la destination";
  const lines = [];
  for (let d = 1; d <= days; d++) {
    const dayAttr = attractions.filter((_, i) => i % days === d - 1);
    const txt = dayAttr.length ? dayAttr.map((a) => a.name).join(", ") : `incontournables de ${dest}`;
    lines.push(`- **Jour ${d}** : ${txt}.`);
  }
  return lines.join("\n");
}

/**
 * Appel Markdown avec UN retry si la réponse est tronquée (finish_reason length).
 * Le retry demande de réécrire 40% plus court.
 */
async function markdownWithRetry(system, user, { maxTokens, model, temperature = 0.5 }) {
  const first = await mistralChatFull(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { json: false, temperature, maxTokens, model }
  );
  const firstMd = cleanMarkdown(first.content);
  if (first.finishReason !== "length") {
    return { md: firstMd, finishReason: first.finishReason, retried: false };
  }
  // Retry une seule fois, plus court.
  const retryUser =
    user +
    "\n\nIMPORTANT : ta réponse précédente a été coupée car trop longue. " +
    "Réécris 40% plus court, garde uniquement l'essentiel, et TERMINE par une phrase complète.";
  const second = await mistralChatFull(
    [
      { role: "system", content: system },
      { role: "user", content: retryUser },
    ],
    { json: false, temperature: Math.max(0.2, temperature - 0.2), maxTokens, model }
  );
  const secondMd = cleanMarkdown(second.content);
  if (second.finishReason !== "length" && secondMd.length >= 40) {
    return { md: secondMd, finishReason: second.finishReason, retried: true };
  }
  // Toujours tronqué : on garde la version la plus complète.
  return {
    md: secondMd.length > firstMd.length ? secondMd : firstMd,
    finishReason: "length",
    retried: true,
  };
}

/** Article de blog : 3 parties concises en Markdown brut (avec retry). */
async function generateBlogMarkdown(research) {
  const days = parseDays(research.idea);
  const daysHint = days ? ` Respecte EXACTEMENT ${days} jours (pas de Jour ${days + 1}).` : "";
  const system =
    "Tu es rédacteur voyage senior pour TripPilot Guides, un média premium de guides de voyage PDF. " +
    "STYLE : prose fluide, immersive et engageante, comme un ami qui donne envie de partir. " +
    "Phrases variées, transitions naturelles, quelques images sensorielles.\n" +
    "RÔLE DE L'ARTICLE : c'est un article de BLOG GRATUIT qui sert d'APERÇU et donne envie " +
    "d'acheter le guide PDF complet. Il informe et inspire, MAIS il ne dévoile PAS tout.\n" +
    "RÈGLE CLÉ (différenciation produit) :\n" +
    "- NE DONNE PAS l'itinéraire heure par heure détaillé (matin/après-midi/soir avec adresses " +
    "précises et prix de chaque lieu). Ça, c'est le contenu du guide payant.\n" +
    "- Donne plutôt une VUE D'ENSEMBLE : les incontournables, un aperçu condensé de l'itinéraire " +
    "(une ligne par jour), des fourchettes de budget globales, et quelques conseils.\n" +
    "- Reste concret et utile (le lecteur doit te faire confiance), mais laisse-le vouloir le " +
    "détail complet, le planning optimisé et les bonnes adresses dans le guide.\n" +
    "FIABILITÉ : appuie-toi sur les données de recherche ; pour toute info non sourcée, reste prudent.\n" +
    "FORMATAGE : Titres ## et ### uniquement (JAMAIS de #, JAMAIS de double dièse comme '### ###'). " +
    "Listes à puces, **gras** sur les lieux/chiffres clés (astérisques UNIQUEMENT par paires, " +
    "jamais isolés). N'invente pas de noms précis non présents dans la recherche. " +
    "Paragraphes courts (max 4 phrases). " +
    "N'ajoute PAS de disclaimer, sources ni CTA (ajoutés automatiquement). " +
    "TERMINE toujours par une phrase complète. Markdown BRUT.";

  const defs = [
    {
      name: "blog-intro-highlights",
      instr:
        "Rédige UNIQUEMENT :\n" +
        "- Une introduction captivante (3-4 phrases) qui pose l'ambiance et donne envie.\n" +
        "## Les incontournables de la destination\n" +
        "5 à 7 lieux/expériences phares, chacun en 1-2 phrases évocatrices (PAS d'horaires, " +
        "PAS de plan détaillé — juste pourquoi c'est incontournable).\n" +
        "## L'itinéraire en un coup d'œil\n" +
        "Un aperçu CONDENSÉ : une seule ligne par jour (ex: « **Jour 1** — Acropole et vieille ville »)." +
        daysHint +
        "\nNe détaille PAS chaque journée heure par heure : c'est réservé au guide complet.",
      maxTokens: 1800,
      words: 450,
      fb: () =>
        `Préparez votre voyage à ${research.destination || "votre destination"} sans stress.\n\n` +
        `## L'itinéraire en un coup d'œil\n\n${shortItinerary(research)}`,
    },
    {
      name: "blog-budget-tips",
      instr:
        "Rédige UNIQUEMENT :\n" +
        "## Quel budget prévoir ?\n" +
        "Un paragraphe d'introduction, puis un PETIT tableau Markdown à 3 colonnes " +
        "(Routard / Équilibré / Confort) avec UNE seule ligne « Budget par jour ». " +
        "Reste sur des fourchettes globales, sans détailler chaque poste (ça, c'est le guide).\n\n" +
        "## 4 conseils pour réussir son séjour\n" +
        "4 conseils concrets et utiles (erreurs fréquentes à éviter), 1-2 phrases chacun.",
      maxTokens: 1500,
      words: 380,
      fb: () =>
        `## Quel budget prévoir ?\n\n| Routard | Équilibré | Confort |\n| --- | --- | --- |\n| à vérifier | à vérifier | à vérifier |\n\n` +
        `## 4 conseils pour réussir son séjour\n\n- Réserver les sites majeurs à l'avance.\n- Éviter les restaurants trop touristiques.`,
    },
    {
      name: "blog-why-guide",
      instr:
        "Rédige UNIQUEMENT :\n" +
        "## Aller plus loin : le guide complet\n" +
        "Un court paragraphe (3-4 phrases) qui explique ce que le voyageur trouvera dans le guide " +
        "PDF complet et qui n'est PAS dans cet article : l'itinéraire détaillé jour par jour " +
        "(matin/après-midi/soir), les bonnes adresses testées, le budget poste par poste, la carte " +
        "des quartiers et la checklist imprimable. Ton enthousiaste mais honnête, sans survente.",
      maxTokens: 700,
      words: 160,
      fb: () =>
        `## Aller plus loin : le guide complet\n\nLe guide PDF complet détaille l'itinéraire jour par jour, les bonnes adresses, le budget poste par poste et une checklist imprimable.`,
    },
  ];

  const parts = [];
  const blogParts = [];
  let complete = true;
  for (const d of defs) {
    try {
      const sys = system.replace("Style CONCIS", `Style CONCIS, maximum ${d.words} mots`);
      const user = "DONNÉES DE RECHERCHE :\n" + researchContext(research) + "\n\n" + d.instr +
        "\nNe mets pas de bloc ```; renvoie directement le Markdown.";
      const { md, finishReason } = await markdownWithRetry(sys, user, { maxTokens: d.maxTokens, model: MODEL, temperature: 0.6 });
      const ok = finishReason !== "length" && md.length >= 40;
      blogParts.push({ name: d.name, complete: ok, finishReason, maxTokens: d.maxTokens });
      if (ok) {
        parts.push(md);
      } else if (md && md.length >= 120) {
        parts.push(md + "\n\n_⚠️ Section à relire (réponse tronquée)._");
        complete = false;
      } else {
        parts.push(d.fb());
        complete = false;
      }
    } catch {
      blogParts.push({ name: d.name, complete: false, finishReason: "error", maxTokens: d.maxTokens });
      parts.push(d.fb());
      complete = false;
    }
  }
  return { markdown: parts.join("\n\n"), complete, blogParts };
}

/** Plan de guide PDF : petites parties concises (évite la troncature), assemblées. */
async function generateGuidePart(research, instructions, maxTokens, wordTarget) {
  const system =
    "Tu es l'auteur d'un guide de voyage PDF PREMIUM et PAYANT pour TripPilot Guides. " +
    "Le client a payé : le contenu doit être RICHE, CONCRET, EXPERT et réellement utile — " +
    "le genre de guide qu'on garde sur soi pendant tout le voyage.\n" +
    "EXIGENCES :\n" +
    "- Prose fluide et vivante, ton d'un ami local expert. Évite le remplissage générique.\n" +
    "- Sois SPÉCIFIQUE : noms de lieux, durées conseillées, prix indicatifs, horaires malins, " +
    "astuces d'initié, où manger à proximité, comment éviter la foule.\n" +
    `- Vise environ ${wordTarget} mots pour cette partie : du contenu dense et valable.\n` +
    "- Appuie-toi sur les données de recherche ; pour toute info non vérifiée, reste prudent " +
    "(« comptez environ », « à vérifier »).\n" +
    "FIABILITÉ ABSOLUE (un produit payant ne peut pas mentir) :\n" +
    "- N'invente JAMAIS de noms de restaurants, d'hôtels, de prix précis ni de faits " +
    "historiques (emplacement d'une œuvre dans tel musée, dates exactes…). Utilise EN " +
    "PRIORITÉ les lieux présents dans les DONNÉES DE RECHERCHE.\n" +
    "- Si tu n'as pas d'adresse vérifiée, reste GÉNÉRIQUE (« une taverne du quartier », " +
    "« un café local près de la place ») plutôt que d'inventer un nom précis.\n" +
    "- Ne cite pas d'anecdote historique précise si tu n'en es pas certain.\n" +
    "NON-RÉPÉTITION : ne répète pas d'un section à l'autre les mêmes conseils ou adresses.\n" +
    "FORMAT : Titres ## et ### uniquement (jamais de #, jamais de double dièse). " +
    "Mets en **gras** les lieux et chiffres clés — les astérisques UNIQUEMENT par paires " +
    "pour le gras, JAMAIS d'astérisque isolé ni de note en bas de page avec *. " +
    "Listes à puces quand pertinent. " +
    "TERMINE toujours par une phrase complète. Markdown BRUT (pas de bloc de code englobant).";
  const user =
    "DONNÉES DE RECHERCHE :\n" +
    researchContext(research) +
    "\n\n" +
    instructions +
    "\nNe mets pas de bloc ```; renvoie directement le Markdown.";
  // Utilise le retry-si-tronqué pour garantir une section complète.
  const { md, finishReason } = await markdownWithRetry(system, user, {
    maxTokens,
    model: GUIDE_MODEL,
    temperature: 0.4,
  });
  return { md, finishReason };
}

async function generateGuideOutlineMarkdown(research) {
  const days = parseDays(research.idea);
  const daysHint = days ? `Respecte EXACTEMENT ${days} jours (pas de Jour ${days + 1}).` : "";
  const defs = [
    {
      name: "intro",
      instr:
        `Rédige UNIQUEMENT :\n## Bienvenue à ${research.destination || "destination"}\n` +
        "Une introduction chaleureuse et experte (180-250 mots) : ce qui rend la destination " +
        "unique, l'ambiance des quartiers, à quoi s'attendre, la meilleure période, et comment " +
        "tirer le meilleur de ce guide. Donne envie tout en restant concret.",
      maxTokens: 1300,
      words: 230,
      fb: () =>
        `## Bienvenue à ${research.destination || "destination"}\n\nCe guide vous accompagne pas à pas pour profiter pleinement de votre séjour.`,
    },
    {
      name: "itinerary",
      instr:
        "Rédige UNIQUEMENT :\n## Itinéraire jour par jour\n" +
        "Pour CHAQUE jour : un titre `### Jour X — thème évocateur`, puis une ligne " +
        "`**En bref :** ...` qui résume la journée en une phrase (les 2-3 temps forts). " +
        "Ensuite un court paragraphe d'introduction, puis **Matin**, **Après-midi**, **Soir** " +
        "(en gras, suivis d'un tiret —) avec à chaque fois un VRAI paragraphe détaillé : lieux " +
        "précis, ce qu'on y voit et pourquoi, durée conseillée, prix indicatif, astuce d'initié. " +
        "Tu peux suggérer UNE table par soir maximum, sans jamais répéter une adresse déjà " +
        "citée un autre jour. " +
        daysHint,
      maxTokens: 4000,
      words: 1200,
      fb: () => buildGuideFallbackItinerary(research),
    },
    {
      name: "budget",
      instr:
        "Rédige UNIQUEMENT :\n## Budget détaillé\n" +
        "Un paragraphe d'introduction, puis DEUX tableaux Markdown : (1) budget par poste et par " +
        "jour ; (2) budget total du séjour par niveau (Bas / Moyen / Confort). Termine par 3 " +
        "astuces d'économie concrètes et spécifiques à la destination.",
      maxTokens: 1800,
      words: 450,
      fb: () => buildGuideFallbackBudget(research),
    },
    {
      name: "sleep",
      instr:
        "Rédige UNIQUEMENT :\n## Où dormir : les meilleurs quartiers\n" +
        "Présente 3 à 4 quartiers : pour chacun, un paragraphe sur l'ambiance, pour qui c'est " +
        "idéal, la fourchette de prix par nuit, et les points d'attention. Termine par un " +
        "conseil de réservation (quand réserver, quoi éviter).",
      maxTokens: 1800,
      words: 480,
      fb: () =>
        `## Où dormir : les meilleurs quartiers\n\n- Quartier central : pratique pour tout faire à pied.\n- Quartier authentique : meilleure ambiance locale.`,
    },
    {
      name: "transport-food",
      instr:
        "Rédige UNIQUEMENT :\n## Se déplacer sur place\n" +
        "Depuis l'aéroport jusqu'au centre (options, prix, durée), le pass transport le plus " +
        "rentable, les déplacements sur place et les astuces (cartes, applis). Concret.\n\n" +
        "## Que manger : les spécialités à goûter\n" +
        "NE RE-LISTE PAS les restaurants déjà cités dans l'itinéraire. Présente plutôt 6 à 8 " +
        "SPÉCIALITÉS culinaires locales (plats, street food, douceurs, boissons) : ce que c'est, " +
        "où en trouver de la bonne (type de lieu / quartier, pas forcément un nom précis), et la " +
        "fourchette de prix. Ajoute une astuce pour repérer une bonne adresse et éviter les pièges.",
      maxTokens: 2400,
      words: 600,
      fb: () => buildGuideFallbackSources(research),
    },
    {
      name: "tips-checklist",
      instr:
        "Rédige UNIQUEMENT :\n## Conseils pratiques & erreurs à éviter\n" +
        "6 à 8 conseils NOUVEAUX et spécifiques (sécurité, horaires locaux, étiquette, météo, " +
        "argent/paiement, connectivité…). NE répète PAS la réservation des sites ni les conseils " +
        "déjà évidents dans l'itinéraire.\n\n" +
        "## Planning type d'une journée\n" +
        "Un tableau Markdown : colonnes Moment / Activité / Budget indicatif.\n\n" +
        "## Checklist imprimable\n" +
        "Une liste de cases `- [ ]` regroupées (documents, argent, valise, réservations, jour du départ).",
      maxTokens: 2000,
      words: 550,
      fb: () => buildGuideFallbackChecklist(research),
    },
  ];

  const parts = [];
  const guideParts = [];
  let complete = true;
  for (const d of defs) {
    try {
      const { md, finishReason } = await generateGuidePart(research, d.instr, d.maxTokens, d.words);
      const ok = finishReason !== "length" && md.length >= 40;
      guideParts.push({ name: d.name, complete: ok, finishReason, maxTokens: d.maxTokens });
      if (ok) {
        parts.push(md);
      } else if (md && md.length >= 120) {
        // Partie tronquée mais exploitable : on la garde avec une note de relecture.
        parts.push(md + "\n\n_⚠️ Section à relire (réponse tronquée)._");
        complete = false;
      } else {
        parts.push(d.fb());
        complete = false;
      }
    } catch {
      guideParts.push({ name: d.name, complete: false, finishReason: "error", maxTokens: d.maxTokens });
      parts.push(d.fb());
      complete = false;
    }
  }
  return { markdown: parts.join("\n\n"), complete, guideParts };
}

/** Replis locaux du plan de guide (par partie), à partir de la recherche. */
function buildGuideFallbackStructurePdf() {
  return [
    `## Structure du PDF`,
    `1. Couverture`,
    `2. Itinéraire jour par jour`,
    `3. Budget`,
    `4. Transports & quartiers`,
    `5. Checklist imprimable`,
  ].join("\n");
}

function buildGuideFallbackPages() {
  return [
    `## Pages prévues`,
    `- p.1 Couverture`,
    `- p.2 Sommaire`,
    `- p.3+ Itinéraire jour par jour`,
    `- Budget, transports & quartiers`,
    `- Checklist imprimable`,
  ].join("\n");
}

function buildGuideFallbackBudget() {
  return [
    `## Budget`,
    `| Jour | Indicatif |`,
    `| --- | --- |`,
    `| Par jour | à vérifier |`,
    ``,
    `| Poste | Bas | Moyen | Confort |`,
    `| --- | --- | --- | --- |`,
    `| Hébergement / nuit | à vérifier | à vérifier | à vérifier |`,
    `| Repas / jour | à vérifier | à vérifier | à vérifier |`,
  ].join("\n");
}

function buildGuideFallbackItinerary(research) {
  const days = parseDays(research.idea) || (research.attractions?.length ? Math.min(research.attractions.length, 4) : 3);
  const attractions = research.attractions?.length ? research.attractions : [];
  const dest = research.destination || "la destination";
  const lines = [`## Itinéraire jour par jour`];
  for (let d = 1; d <= days; d++) {
    lines.push(`\n### Jour ${d}`);
    // Répartit les attractions sur le nombre EXACT de jours (round-robin).
    const dayAttractions = attractions.filter((_, i) => i % days === d - 1);
    if (dayAttractions.length) {
      dayAttractions.forEach((a) =>
        lines.push(`- ${a.name}${a.priceIndicatif ? ` (prix indicatif : ${a.priceIndicatif})` : ""}`)
      );
    } else {
      lines.push(`- À compléter avec les incontournables de ${dest}.`);
    }
  }
  lines.push(`\n## Planning type d'une journée`);
  lines.push(`| Matin | Midi | Après-midi | Soir |`);
  lines.push(`| --- | --- | --- | --- |`);
  lines.push(`| Visite principale | Pause déjeuner | Quartier à pied | Dîner |`);
  lines.push(`\n## Alternatives pluie / fatigue`);
  lines.push(`- Musées couverts, café, marché couvert ; journée allégée si besoin.`);
  return lines.join("\n");
}

function buildGuideFallbackChecklist() {
  const lines = [`## Checklist imprimable`];
  ["Documents", "Budget et moyens de paiement", "Transport (billets, pass)", "Logement (adresse, check-in)", "Valise", "Applis utiles"].forEach(
    (c) => lines.push(`- [ ] ${c}`)
  );
  lines.push(`\n## Éléments visuels à créer dans Canva`);
  lines.push(`- Couverture, carte des quartiers, icônes budget, encadrés.`);
  return lines.join("\n");
}

function buildGuideFallbackSources(research) {
  const lines = [`## Liens à vérifier`];
  if (research.sources?.length) {
    research.sources.forEach((s) => lines.push(`- ${s.title} : ${s.url}`));
  } else {
    lines.push(`- Sites officiels des attractions, transports et hébergements.`);
  }
  lines.push(`\n## À vérifier avant le départ`);
  (research.needsVerification?.length ? research.needsVerification : ["Prix, horaires et conditions d'accès"]).forEach(
    (n) => lines.push(`- ${n}`)
  );
  return lines.join("\n");
}

function buildGuideFallback(research) {
  return [
    buildGuideFallbackStructurePdf(),
    buildGuideFallbackPages(),
    buildGuideFallbackBudget(),
    buildGuideFallbackItinerary(research),
    buildGuideFallbackChecklist(),
    buildGuideFallbackSources(research),
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

/** Collecte les nombres présents dans la recherche (prix indicatifs, etc.). */
function collectResearchNumbers(research) {
  const set = new Set();
  const grab = (s) => (String(s || "").match(/\d+/g) || []).forEach((n) => set.add(n));
  (research.attractions || []).forEach((a) => grab(a.priceIndicatif));
  (research.transports || []).forEach(grab);
  grab(research.angle);
  return set;
}

/** Supprime/atténue les promesses chiffrées non sourcées du social, proprement. */
function sanitizeUnsupportedSocialClaims(md, research) {
  const allowed = collectResearchNumbers(research);
  const unsourced = (numStr) =>
    (String(numStr).match(/\d+/g) || []).some((n) => !allowed.has(n));
  let out = md;

  // Promesses d'économie en pourcentage
  out = out.replace(/écono\w*[^.\n!?]*?\d+\s*%/gi, "économiser sur votre budget");

  // "tout faire pour (moins de) X€"
  out = out.replace(
    /tout faire pour\s*(?:moins de\s*)?([\d.,]+)\s*(?:€|euros?)/gi,
    (m, n) => (unsourced(n) ? "tout organiser avec un budget maîtrisé" : m)
  );

  // "(pour) moins de X€ [/ par jour]"
  out = out.replace(
    /(?:pour\s+)?moins de\s*([\d.,]+)\s*(?:€|euros?)(?:\s*\/?\s*(?:par\s+)?jour)?/gi,
    (m, n) => (unsourced(n) ? "avec un budget maîtrisé" : m)
  );

  // "coûte(nt) (environ) X€" ou fourchette
  out = out.replace(
    /coûtent\s+(?:environ\s+|autour de\s+)?([\d.,]+(?:\s*[–-]\s*[\d.,]+)?)\s*(?:€|euros?)/gi,
    (m, n) => (unsourced(n) ? "restent abordables" : m)
  );
  out = out.replace(
    /coûte\s+(?:environ\s+|autour de\s+)?([\d.,]+(?:\s*[–-]\s*[\d.,]+)?)\s*(?:€|euros?)/gi,
    (m, n) => (unsourced(n) ? "reste abordable" : m)
  );

  // "à X-Y€" (fourchette) -> "à prix accessible"
  out = out.replace(
    /à\s+([\d.,]+\s*[–-]\s*[\d.,]+)\s*(?:€|euros?)/gi,
    (m, n) => (unsourced(n) ? "à prix accessible" : m)
  );
  // "à X€" (valeur unique) -> "à petit prix"
  out = out.replace(
    /à\s+([\d.,]+)\s*(?:€|euros?)/gi,
    (m, n) => (unsourced(n) ? "à petit prix" : m)
  );

  // Promesses trop fortes
  out = out.replace(/sans rien (rater|manquer)/gi, "en profitant de l'essentiel");

  // Reste : prix générique non sourcé -> "à tarif indicatif"
  out = out.replace(/([\d.,]+)\s*(?:€|euros?)/gi, (m, n) =>
    unsourced(n) ? "à tarif indicatif" : m
  );

  return out;
}

/** Corrige les tournures bancales pouvant subsister après nettoyage des prix. */
function cleanAwkwardSocialPhrases(md) {
  return md
    .replace(/coûtent\s+avec un budget maîtrisé/gi, "restent abordables")
    .replace(/coûte\s+avec un budget maîtrisé/gi, "reste abordable")
    .replace(/coûte\s+à tarif indicatif/gi, "reste abordable")
    .replace(/pour\s+avec un budget maîtrisé/gi, "avec un budget maîtrisé")
    .replace(/à\s+avec un budget maîtrisé/gi, "à petit prix")
    .replace(/à\s+budget indicatif/gi, "à prix indicatif")
    .replace(/\bbudget indicatif\b/gi, "budget maîtrisé");
}

/** Contenus réseaux sociaux : Markdown BRUT (avec normalisation si JSON renvoyé). */
async function generateSocialMarkdown(research) {
  const system =
    "Tu es directeur créatif social media pour TripPilot Guides, une marque premium de guides de voyage PDF. " +
    "Ton style : aspirationnel, concret et émotionnel. Tu crées du contenu qui STOPPE le scroll sur Pinterest. " +
    "RÈGLES STRICTES :\n" +
    "1. Seule la CHECKLIST est gratuite. Le guide PDF complet est payant.\n" +
    "2. N'invente AUCUN chiffre non présent dans les données de recherche.\n" +
    "3. Pas de promesses vagues (« économiser 50% », « sans rien rater »).\n" +
    "4. Chaque titre Pinterest DOIT donner envie de cliquer en jouant sur : la curiosité, la peur de mal faire, " +
    "le gain de temps, ou l'émotion du voyage.\n" +
    "5. Les titres Pinterest font 6-10 mots MAX, percutants, avec UN angle précis.\n" +
    "Tu réponds en Markdown BRUT.";
  const user =
    "DONNÉES DE RECHERCHE :\n" +
    researchContext(research) +
    "\n\n" +
    "Rédige ces trois sections :\n\n" +
    "## Idées Pinterest (10)\n" +
    "10 titres d'épingles COURTS et PERCUTANTS (format liste numérotée).\n" +
    "Chaque titre : 6-10 mots, UN angle précis, donne envie de sauvegarder.\n" +
    "Exemples de formats qui marchent :\n" +
    "- « [Ville] : [X] erreurs que tout le monde fait »\n" +
    "- « Mon itinéraire [X] jours à [Ville] (testé) »\n" +
    "- « [Ville] avec [budget] : c'est possible »\n" +
    "- « Où dormir à [Ville] selon ton budget »\n" +
    "- « [Ville] : le quartier que personne ne connaît »\n" +
    "Ajoute 3-5 hashtags pertinents après chaque titre.\n\n" +
    "## Hooks TikTok / Reels (10)\n" +
    "10 accroches de 1-2 phrases qui créent de la tension/curiosité.\n" +
    "Formats : question provocante, « Si tu pars à [Ville]... », contre-intuition, storytelling.\n\n" +
    "## Scripts courts (5)\n" +
    "5 scripts de 15-30s : hook émotionnel + valeur concrète + CTA.\n" +
    "CTA = checklist gratuite OU guide PDF complet (payant).\n\n" +
    "Ne mets pas de bloc ```; renvoie directement le Markdown.";

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
  return cleanAwkwardSocialPhrases(
    sanitizeUnsupportedSocialClaims(sanitizeSocialText(md), research)
  );
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

/** Exclut les sources hors-sujet (SEO, Pinterest, marketing) du blog. */
function isRelevantSource(s) {
  const haystack = `${s?.title || ""} ${s?.url || ""}`.toLowerCase();
  const banned = [
    "pinterest",
    "seo",
    "accio.com",
    "tendances",
    "trends",
    "mots-clés",
    "mots-cles",
    "keyword",
    "marketing",
    "growth",
    "hashtag",
  ];
  return !banned.some((b) => haystack.includes(b));
}

function sourcesSection(research) {
  const relevant = (research.sources || []).filter(isRelevantSource);
  if (!relevant.length) {
    return (
      "\n\n## Sources\n\n_Aucune source vérifiée n'a été collectée pour ce brouillon : " +
      "les informations doivent être confirmées avant toute publication._\n"
    );
  }
  return (
    "\n\n## Sources\n\n" +
    relevant.map((s) => `- [${s.title}](${s.url})`).join("\n") +
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
        guideModel: GUIDE_MODEL,
        blogParts: blog.blogParts || [],
        guideParts: guide.guideParts || [],
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
