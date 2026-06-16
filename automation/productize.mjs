/**
 * TripPilot Guides — V2 Business Automation : Productize.
 *
 * Pour chaque brouillon "publish_candidate" (score >= 9) :
 * 1. Génère un pack complet dans automation/products/<slug>/
 * 2. Crée/met à jour les fichiers site (src/content/) en draft: true
 *
 * Ne publie jamais, ne supprime jamais, ne force pas d'écriture si fichier existant.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DRAFTS_DIR = path.join(ROOT, "automation", "drafts");
const PRODUCTS_DIR = path.join(ROOT, "automation", "products");
const RESEARCH_DIR = path.join(ROOT, "automation", "research");
const REVIEW_FILE = path.join(ROOT, "automation", "output", "review.json");
const SUMMARY_FILE = path.join(ROOT, "automation", "output", "summary.json");

const BLOG_DIR = path.join(ROOT, "src", "content", "blog");
const GUIDES_DIR = path.join(ROOT, "src", "content", "guides");
const CHECKLISTS_DIR = path.join(ROOT, "src", "content", "checklists");

const REQUIRED_SCORE = 9;
const REQUIRED_STATUS = "publish_candidate";

async function readSafe(filepath) {
  try {
    return await fs.readFile(filepath, "utf8");
  } catch {
    return "";
  }
}

async function writeIfNotExists(filepath, content, label) {
  try {
    await fs.access(filepath);
    console.log(`  ⏭️  ${label} existe déjà — non écrasé.`);
    return false;
  } catch {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, content, "utf8");
    console.log(`  ✅ ${label} créé.`);
    return true;
  }
}

function extractFrontmatterField(md, field) {
  const m = md.match(new RegExp(`^${field}:\\s*"?(.+?)"?\\s*$`, "m"));
  return m ? m[1].trim() : "";
}

function guessDestination(idea) {
  const m = String(idea || "").match(/^([A-ZÀ-Ÿ][\p{L}'' -]+?)\s+(?:en|le|la|pour|à|:|\d)/u);
  return (m ? m[1] : idea.split(/[,:]/)[0]).trim();
}

function guessDuration(idea) {
  const m = String(idea || "").match(/(\d+)\s*jours?/i);
  return m ? `${m[1]} jours` : "";
}

function generateGuideContent(slug, research, guideOutline) {
  const dest = research?.destination || guessDestination(research?.idea || slug);
  const duration = guessDuration(research?.idea || "");
  const title = `${dest}${duration ? ` en ${duration}` : ""} — guide complet`;
  const desc = `Guide PDF ${dest} : itinéraire jour par jour, budget détaillé, transports, quartiers et checklist imprimable.`;
  const fm = [
    "---",
    `title: "${title}"`,
    `description: "${desc}"`,
    `destination: "${dest}"`,
    `duration: "${duration}"`,
    `budget: ""`,
    `price: "9€"`,
    `emoji: "📍"`,
    `gradient: "from-brand-500 via-accent-500 to-accent-600"`,
    `buyLink: "TODO_GUMROAD_OR_PAYHIP_LINK"`,
    `checklistLink: "/checklists/${slug}"`,
    `draft: true`,
    "---",
  ].join("\n");
  const body = guideOutline || `## Contenu du guide\n\nÀ compléter.\n`;
  return { content: `${fm}\n\n${body}\n`, title, desc, dest };
}

function generateChecklistContent(slug, research) {
  const dest = research?.destination || guessDestination(research?.idea || slug);
  const title = `Checklist gratuite — ${dest}`;
  const desc = `Recevez une checklist simple pour préparer votre voyage à ${dest} sans rien oublier.`;
  const fm = [
    "---",
    `title: "${title}"`,
    `description: "${desc}"`,
    `destination: "${dest}"`,
    `emoji: "📝"`,
    `gradient: "from-emerald-400 via-teal-400 to-cyan-500"`,
    `formLink: "TODO_TALLY_OR_MAILERLITE_LINK"`,
    `guideSlug: "${slug}"`,
    `draft: true`,
    "---",
  ].join("\n");
  const body = [
    "## Ce que contient la checklist\n",
    "- Documents (passeport, billets, assurance)",
    "- Budget et moyens de paiement",
    "- Transports (aéroport, local)",
    "- Logement (adresse, check-in)",
    "- Valise (vêtements, chargeurs, chaussures)",
    "- Applis utiles (cartes hors-ligne, traduction)",
    "",
    "## FAQ\n",
    "**C'est vraiment gratuit ?** Oui, la checklist est 100 % gratuite en PDF.",
    "",
    `**Et le guide complet ?** Le guide PDF complet (itinéraire, budget, conseils) est disponible séparément. [Voir le guide](/guides/${slug}).`,
  ].join("\n");
  return { content: `${fm}\n\n${body}\n`, title, desc, dest };
}

function generateProductJson(slug, research, guideInfo, checklistInfo) {
  return JSON.stringify(
    {
      slug,
      title: guideInfo.title,
      destination: guideInfo.dest,
      angle: research?.angle || research?.idea || "",
      priceSuggestion: "9€",
      buyLink: "TODO_GUMROAD_OR_PAYHIP_LINK",
      checklistFormLink: "TODO_TALLY_OR_MAILERLITE_LINK",
      blogPath: `/blog/${slug}`,
      guidePagePath: `/guides/${slug}`,
      checklistPagePath: `/checklists/${slug}`,
      printGuidePath: `/print/guide/${slug}`,
      printChecklistPath: `/print/checklist/${slug}`,
      status: "draft",
      createdAt: new Date().toISOString(),
    },
    null,
    2
  );
}

function generateReadme(slug, guideInfo) {
  return [
    `# Pack produit — ${guideInfo.title}\n`,
    `Status : **draft** (non publié)\n`,
    `## Fichiers\n`,
    `- \`product.json\` — métadonnées du produit`,
    `- \`guide.md\` — contenu de la page guide (src/content/guides/${slug}.md)`,
    `- \`checklist.md\` — contenu de la page checklist (src/content/checklists/${slug}.md)`,
    `- \`social.md\` — contenus réseaux sociaux`,
    `- \`README.md\` — ce fichier\n`,
    `## Prochaines étapes\n`,
    `1. Remplacer \`TODO_GUMROAD_OR_PAYHIP_LINK\` par le lien d'achat réel.`,
    `2. Remplacer \`TODO_TALLY_OR_MAILERLITE_LINK\` par le formulaire email.`,
    `3. Relire et corriger les contenus.`,
    `4. Passer \`draft: false\` dans les fichiers src/content/.`,
    `5. \`npm run build\` puis commit/push.`,
  ].join("\n");
}

async function main() {
  let review, summary;
  try {
    review = JSON.parse(await fs.readFile(REVIEW_FILE, "utf8"));
  } catch {
    console.log("⚠️ review.json introuvable. Aucun pack produit.");
    return;
  }
  try {
    summary = JSON.parse(await fs.readFile(SUMMARY_FILE, "utf8"));
  } catch {
    summary = {};
  }

  const candidates = (review.items || []).filter(
    (i) => i.status === REQUIRED_STATUS && i.score >= REQUIRED_SCORE
  );

  if (!candidates.length) {
    console.log("=== Productize ===");
    console.log("Aucun brouillon publish_candidate (score >= 9). Rien à produire.");
    summary.productize = { count: 0, products: [], errors: [] };
    await fs.mkdir(path.dirname(SUMMARY_FILE), { recursive: true });
    await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
    return;
  }

  console.log(`=== Productize (${candidates.length} candidat(s)) ===`);
  const results = { count: 0, products: [], errors: [] };

  for (const item of candidates) {
    const slug = item.slug;
    console.log(`\n📦 ${slug} (score: ${item.score})`);

    try {
      const draftDir = path.join(DRAFTS_DIR, slug);
      const blog = await readSafe(path.join(draftDir, "blog.md"));
      const guideOutline = await readSafe(path.join(draftDir, "guide-outline.md"));
      const social = await readSafe(path.join(draftDir, "social.md"));

      let research = null;
      try {
        research = JSON.parse(await fs.readFile(path.join(RESEARCH_DIR, `${slug}.json`), "utf8"));
      } catch { /* pas critique */ }

      // Générer le contenu
      const guideInfo = generateGuideContent(slug, research, guideOutline);
      const checklistInfo = generateChecklistContent(slug, research);
      const productJson = generateProductJson(slug, research, guideInfo, checklistInfo);
      const readme = generateReadme(slug, guideInfo);

      // Pack dans automation/products/<slug>/
      const prodDir = path.join(PRODUCTS_DIR, slug);
      await fs.mkdir(prodDir, { recursive: true });
      await writeIfNotExists(path.join(prodDir, "product.json"), productJson, `products/${slug}/product.json`);
      await writeIfNotExists(path.join(prodDir, "guide.md"), guideInfo.content, `products/${slug}/guide.md`);
      await writeIfNotExists(path.join(prodDir, "checklist.md"), checklistInfo.content, `products/${slug}/checklist.md`);
      await writeIfNotExists(path.join(prodDir, "social.md"), social || "# Social\n\nÀ compléter.\n", `products/${slug}/social.md`);
      await writeIfNotExists(path.join(prodDir, "README.md"), readme, `products/${slug}/README.md`);

      // Fichiers site (src/content/) en draft: true
      await writeIfNotExists(path.join(GUIDES_DIR, `${slug}.md`), guideInfo.content, `src/content/guides/${slug}.md`);
      await writeIfNotExists(path.join(CHECKLISTS_DIR, `${slug}.md`), checklistInfo.content, `src/content/checklists/${slug}.md`);
      await writeIfNotExists(path.join(BLOG_DIR, `${slug}.md`), blog || "---\ntitle: \"À compléter\"\ndescription: \"\"\npubDate: 2026-01-01\ndraft: true\n---\n", `src/content/blog/${slug}.md`);

      results.count++;
      results.products.push({
        slug,
        score: item.score,
        files: [
          `automation/products/${slug}/product.json`,
          `automation/products/${slug}/guide.md`,
          `automation/products/${slug}/checklist.md`,
          `automation/products/${slug}/social.md`,
          `src/content/guides/${slug}.md`,
          `src/content/checklists/${slug}.md`,
          `src/content/blog/${slug}.md`,
        ],
        todoLinks: ["buyLink: TODO_GUMROAD_OR_PAYHIP_LINK", "checklistFormLink: TODO_TALLY_OR_MAILERLITE_LINK"],
      });
    } catch (err) {
      console.error(`  ❌ Erreur : ${err.message}`);
      results.errors.push(`${slug} : ${err.message}`);
    }
  }

  summary.productize = results;
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
  console.log(`\n✅ ${results.count} pack(s) produit(s). Tous en draft: true.`);
}

main().catch((err) => {
  console.error("Erreur productize :", err?.message || err);
  process.exit(0);
});
