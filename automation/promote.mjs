/**
 * TripPilot Guides — Promotion d'un brouillon vers src/content/blog.
 *
 * Usage :
 *   node automation/promote.mjs <slug>
 *   npm run automation:promote <slug>
 *
 * Conditions :
 *   - Le brouillon doit exister dans automation/drafts/<slug>/blog.md
 *   - Le review.json doit contenir le slug avec score >= 9 et status "publish_candidate"
 *
 * Comportement :
 *   - Copie blog.md vers src/content/blog/<slug>.md
 *   - Conserve draft: true (ne publie PAS automatiquement)
 *   - Ne supprime jamais le brouillon original
 *   - Affiche les fichiers copiés
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DRAFTS_DIR = path.join(ROOT, "automation", "drafts");
const REVIEW_FILE = path.join(ROOT, "automation", "output", "review.json");
const BLOG_DIR = path.join(ROOT, "src", "content", "blog");

const REQUIRED_SCORE = 9;
const REQUIRED_STATUS = "publish_candidate";

async function main() {
  const slug = process.argv[2];

  if (!slug) {
    console.error("❌ Usage : node automation/promote.mjs <slug>");
    console.error("   Exemple : npm run automation:promote cracovie");
    process.exit(1);
  }

  // 1) Vérifier que le brouillon existe
  const draftDir = path.join(DRAFTS_DIR, slug);
  const blogSource = path.join(draftDir, "blog.md");
  try {
    await fs.access(blogSource);
  } catch {
    console.error(`❌ Brouillon introuvable : ${path.relative(ROOT, blogSource)}`);
    console.error(`   Vérifie que automation/drafts/${slug}/blog.md existe.`);
    process.exit(1);
  }

  // 2) Vérifier review.json
  let review;
  try {
    review = JSON.parse(await fs.readFile(REVIEW_FILE, "utf8"));
  } catch {
    console.error("❌ automation/output/review.json introuvable ou illisible.");
    console.error("   Lance d'abord : npm run automation:review");
    process.exit(1);
  }

  const item = (review.items || []).find((i) => i.slug === slug);
  if (!item) {
    console.error(`❌ Slug "${slug}" absent de review.json.`);
    console.error("   Slugs disponibles :", (review.items || []).map((i) => i.slug).join(", ") || "(aucun)");
    process.exit(1);
  }

  if (item.score < REQUIRED_SCORE) {
    console.error(`❌ Score insuffisant : ${item.score}/10 (minimum requis : ${REQUIRED_SCORE}).`);
    console.error(`   Status : ${item.status}`);
    if (item.weaknesses?.length) {
      console.error("   Faiblesses :");
      item.weaknesses.forEach((w) => console.error(`     - ${w}`));
    }
    process.exit(1);
  }

  if (item.status !== REQUIRED_STATUS) {
    console.error(`❌ Status "${item.status}" ≠ "${REQUIRED_STATUS}".`);
    console.error(`   Score : ${item.score}/10. Revérifie review.mjs ou améliore le brouillon.`);
    process.exit(1);
  }

  // 3) Copier blog.md vers src/content/blog/<slug>.md (draft: true conservé)
  await fs.mkdir(BLOG_DIR, { recursive: true });
  const blogDest = path.join(BLOG_DIR, `${slug}.md`);

  // Vérifier qu'on n'écrase pas un article existant sans le vouloir
  try {
    await fs.access(blogDest);
    console.warn(`⚠️  Le fichier ${path.relative(ROOT, blogDest)} existe déjà, il sera écrasé.`);
  } catch {
    // n'existe pas encore, c'est normal
  }

  const content = await fs.readFile(blogSource, "utf8");

  // S'assurer que draft: true est bien présent (sécurité)
  let finalContent = content;
  if (!/^draft:\s*true/m.test(content)) {
    // Ajouter draft: true dans le frontmatter si absent
    finalContent = content.replace(/^---\n/, "---\ndraft: true\n");
  }

  await fs.writeFile(blogDest, finalContent, "utf8");

  console.log("✅ Promotion réussie !");
  console.log(`   Score : ${item.score}/10 · Status : ${item.status}`);
  console.log(`   Source : ${path.relative(ROOT, blogSource)}`);
  console.log(`   → Copié : ${path.relative(ROOT, blogDest)}`);
  console.log("");
  console.log("⚠️  Le fichier est en draft: true — il ne sera PAS publié.");
  console.log("   Pour publier : remplace draft: true par draft: false, puis npm run build.");
  console.log("   Le brouillon original est conservé dans automation/drafts/.");
}

main().catch((err) => {
  console.error("Erreur promote :", err?.message || err);
  process.exit(1);
});
