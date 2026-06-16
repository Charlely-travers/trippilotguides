/**
 * TripPilot Guides - Content Engine V2: Productize.
 *
 * For each publish_candidate draft:
 * - publish the blog article when the review score is high enough;
 * - create a Stripe Payment Link when configured;
 * - prepare a paid guide sales page and keep the full guide in the product pack;
 * - keep guide/checklist pages as drafts until real payment/form links exist;
 * - generate local Pinterest pin assets for the traffic article.
 */

import "./lib/load-env.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  applyBlogFrontmatter,
  decidePublication,
  deriveDestinationMeta,
  getPublishConfig,
  isRealExternalLink,
} from "./lib/publish-rules.mjs";
import { writePinAssets } from "./lib/pin-assets.mjs";
import {
  createStripePaymentLink,
  getStripePaymentConfig,
} from "./lib/stripe-payment-links.mjs";
import { isUsableUrl } from "./lib/env-validation.mjs";

const ROOT = process.cwd();
const DRAFTS_DIR = path.join(ROOT, "automation", "drafts");
const PRODUCTS_DIR = path.join(ROOT, "automation", "products");
const RESEARCH_DIR = path.join(ROOT, "automation", "research");
const REVIEW_FILE = path.join(ROOT, "automation", "output", "review.json");
const SUMMARY_FILE = path.join(ROOT, "automation", "output", "summary.json");

const BLOG_DIR = path.join(ROOT, "src", "content", "blog");
const GUIDES_DIR = path.join(ROOT, "src", "content", "guides");
const CHECKLISTS_DIR = path.join(ROOT, "src", "content", "checklists");
const PUBLIC_PINS_DIR = path.join(ROOT, "public", "pins");

const REQUIRED_STATUS = "publish_candidate";
const SITE_URL = isUsableUrl(process.env.SITE_URL)
  ? process.env.SITE_URL.replace(/\/$/, "")
  : "https://trippilotguides.com";

async function readSafe(filepath) {
  try {
    return await fs.readFile(filepath, "utf8");
  } catch {
    return "";
  }
}

async function readJsonSafe(filepath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filepath, "utf8"));
  } catch {
    return fallback;
  }
}

async function getDeliveryToken(prodDir) {
  const existing = await readJsonSafe(path.join(prodDir, "product.json"), {});
  if (existing?.deliveryToken) return String(existing.deliveryToken);
  return crypto.randomBytes(9).toString("hex");
}

async function writeIfNotExists(filepath, content, label) {
  try {
    await fs.access(filepath);
    console.log(`  skip ${label} already exists`);
    return false;
  } catch {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, content, "utf8");
    console.log(`  created ${label}`);
    return true;
  }
}

async function copyPinAssetsToPublic({ slug, pinFiles }) {
  const targetDir = path.join(PUBLIC_PINS_DIR, slug);
  await fs.mkdir(targetDir, { recursive: true });
  const copied = [];

  for (const source of pinFiles || []) {
    if (!/\.(png|svg|json)$/i.test(source)) continue;
    const target = path.join(targetDir, path.basename(source));
    try {
      await fs.copyFile(source, target);
      copied.push(path.relative(ROOT, target).replace(/\\/g, "/"));
    } catch {
      // Keep productization resilient: Pinterest can skip if an asset is missing.
    }
  }

  return copied;
}

function q(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function extractFrontmatterString(markdown, key) {
  const match = String(markdown || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return "";
  const line = match[1]
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${key}:`));
  if (!line) return "";
  return line
    .slice(line.indexOf(":") + 1)
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function buildGuideMeta(meta) {
  const title = `${meta.destination}${meta.duration ? ` en ${meta.duration}` : ""} - guide complet`;
  const desc = `Guide PDF ${meta.destination} : itineraire jour par jour, budget detaille, transports, quartiers et checklist imprimable.`;
  return { title, desc, dest: meta.destination };
}

function generateGuideContent(slug, research, guideOutline, meta, decision, guideMeta) {
  const { title, desc } = guideMeta;
  const fm = [
    "---",
    `title: ${q(title)}`,
    `description: ${q(desc)}`,
    `destination: ${q(meta.destination)}`,
    `duration: ${q(meta.duration)}`,
    `budget: ""`,
    `price: "9EUR"`,
    `emoji: "📍"`,
    `gradient: "from-brand-500 via-accent-500 to-accent-600"`,
    `buyLink: ${q(decision.buyLink)}`,
    `checklistLink: "/checklists/${slug}"`,
    `draft: ${decision.guideDraft}`,
    "---",
  ].join("\n");
  const landingBody = [
    "## Ce que contient le guide",
    "",
    "- Itineraire jour par jour pret a suivre",
    "- Budget detaille et arbitrages pour eviter les depenses inutiles",
    "- Quartiers ou dormir selon le style de voyage",
    "- Transports, rythme conseille et erreurs a eviter",
    "- Checklist imprimable pour preparer le depart",
    "",
    "## Pour qui ?",
    "",
    `Ce guide est pense pour preparer un voyage a ${meta.destination} sans passer des heures a comparer des dizaines d'onglets.`,
    "",
    "## Livraison",
    "",
    "Le bouton d'achat ouvre la page de paiement securisee configuree pour ce guide.",
  ].join("\n");
  const productBody = guideOutline || "## Contenu du guide\n\nA completer.\n";
  const productContent = [
    `# ${title}`,
    "",
    "> Source interne du produit payant. Ne pas publier directement sur une page publique.",
    "",
    productBody,
  ].join("\n");

  return {
    content: `${fm}\n\n${landingBody}\n`,
    productContent: `${productContent}\n`,
    title,
    desc,
    dest: meta.destination,
  };
}

function generateChecklistContent(slug, meta, decision) {
  const title = `Checklist gratuite - ${meta.destination}`;
  const desc = `Recevez une checklist simple pour preparer votre voyage a ${meta.destination} sans rien oublier.`;
  const formLink =
    decision.formLink === "/api/lead-magnet"
      ? `/api/lead-magnet?slug=${encodeURIComponent(slug)}`
      : decision.formLink;
  const fm = [
    "---",
    `title: ${q(title)}`,
    `description: ${q(desc)}`,
    `destination: ${q(meta.destination)}`,
    `emoji: "📝"`,
    `gradient: "from-emerald-400 via-teal-400 to-cyan-500"`,
    `formLink: ${q(formLink)}`,
    `guideSlug: ${q(slug)}`,
    `draft: ${decision.checklistDraft}`,
    "---",
  ].join("\n");
  const body = [
    "## Ce que contient la checklist",
    "",
    "- Documents (passeport, billets, assurance)",
    "- Budget et moyens de paiement",
    "- Transports (aeroport, local)",
    "- Logement (adresse, check-in)",
    "- Valise (vetements, chargeurs, chaussures)",
    "- Applis utiles (cartes hors-ligne, traduction)",
    "",
    "## FAQ",
    "",
    "**C'est vraiment gratuit ?** Oui, la checklist est gratuite en PDF.",
    "",
    `**Et le guide complet ?** Le guide PDF complet est disponible separement. [Voir le guide](/guides/${slug}).`,
  ].join("\n");
  return { content: `${fm}\n\n${body}\n`, title, desc, dest: meta.destination };
}

function generateFallbackBlog(meta, decision) {
  return [
    "---",
    `title: ${q(`${meta.destination} : guide pratique`)}`,
    `description: ${q(`Conseils pratiques pour preparer un voyage a ${meta.destination}.`)}`,
    `pubDate: ${new Date().toISOString().slice(0, 10)}`,
    `emoji: "📍"`,
    `gradient: "from-brand-500 via-accent-500 to-accent-600"`,
    `readingTime: "7 min"`,
    `destination: ${q(meta.destination)}`,
    `guideSlug: ${q(meta.guideSlug)}`,
    `checklistSlug: ${q(meta.checklistSlug)}`,
    `draft: ${decision.blogDraft}`,
    "---",
    "",
    "## Guide pratique",
    "",
    "Ce brouillon doit etre regenere avec une cle API avant publication.",
  ].join("\n");
}

function generateProductJson(
  slug,
  research,
  guideInfo,
  decision,
  pinCount,
  paymentLink,
  deliveryToken
) {
  return JSON.stringify(
    {
      slug,
      title: guideInfo.title,
      destination: guideInfo.dest,
      angle: research?.angle || research?.idea || "",
      priceSuggestion: "9EUR",
      buyLink: decision.buyLink,
      checklistFormLink: decision.formLink,
      paymentProvider: paymentLink?.provider || "",
      paymentLinkId: paymentLink?.id || "",
      paymentLinkCreated: Boolean(paymentLink?.created),
      deliveryToken,
      publicPinBasePath: `/pins/${slug}`,
      blogPath: `/blog/${slug}`,
      guidePagePath: `/guides/${slug}`,
      checklistPagePath: `/checklists/${slug}`,
      printGuidePath: `/print/guide/${slug}`,
      printChecklistPath: `/print/checklist/${slug}`,
      status: decision.status,
      blogDraft: decision.blogDraft,
      guideDraft: decision.guideDraft,
      checklistDraft: decision.checklistDraft,
      pinCount,
      createdAt: new Date().toISOString(),
    },
    null,
    2
  );
}

function generateReadme(slug, guideInfo, decision, paymentLink) {
  const missing = [
    decision.buyLink
      ? ""
      : "- Add STRIPE_SECRET_KEY or DEFAULT_BUY_LINK to publish the paid guide page.",
    decision.formLink ? "" : "- Set DEFAULT_CHECKLIST_FORM_LINK to publish the checklist lead magnet.",
  ].filter(Boolean);
  return [
    `# Product pack - ${guideInfo.title}`,
    "",
    `Status: **${decision.status}**`,
    "",
    "## Files",
    "",
    "- `product.json` - product metadata",
    "- `guide.md` - internal paid guide source, not the public sales page",
    `- \`checklist.md\` - source for src/content/checklists/${slug}.md`,
    "- `social.md` - generated social copy",
    "- `pins/` - Pinterest SVG/PNG assets",
    "",
    "## Publication",
    "",
    `- Blog public: ${decision.blogDraft ? "no" : "yes"}`,
    `- Paid guide public: ${decision.guideDraft ? "no" : "yes"}`,
    `- Checklist public: ${decision.checklistDraft ? "no" : "yes"}`,
    paymentLink?.created ? `- Stripe payment link: ${paymentLink.url}` : "",
    missing.length ? `\n## To activate the money funnel\n\n${missing.join("\n")}` : "",
  ].join("\n");
}

async function main() {
  const publishConfig = getPublishConfig();
  const stripeConfig = getStripePaymentConfig();
  const review = await readJsonSafe(REVIEW_FILE);
  if (!review) {
    console.log("review.json missing. No product pack created.");
    return;
  }
  const summary = (await readJsonSafe(SUMMARY_FILE, {})) || {};

  const candidates = (review.items || []).filter(
    (item) =>
      item.status === REQUIRED_STATUS &&
      Number(item.score || 0) >= publishConfig.minScore
  );

  if (!candidates.length) {
    console.log("=== Productize V2 ===");
    console.log(`No publish_candidate draft with score >= ${publishConfig.minScore}.`);
    summary.productize = { version: 2, count: 0, products: [], errors: [] };
    await fs.mkdir(path.dirname(SUMMARY_FILE), { recursive: true });
    await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
    return;
  }

  console.log(`=== Productize V2 (${candidates.length} candidate(s)) ===`);
  const results = { version: 2, count: 0, products: [], errors: [] };

  for (const item of candidates) {
    const slug = item.slug;
    console.log(`\nProductizing ${slug} (score: ${item.score})`);

    try {
      const draftDir = path.join(DRAFTS_DIR, slug);
      const blog = await readSafe(path.join(draftDir, "blog.md"));
      const guideOutline = await readSafe(path.join(draftDir, "guide-outline.md"));
      const social = await readSafe(path.join(draftDir, "social.md"));
      const research = await readJsonSafe(path.join(RESEARCH_DIR, `${slug}.json`), {});

      const meta = deriveDestinationMeta({ slug, research });
      const guideMeta = buildGuideMeta(meta);
      let decision = decidePublication({ item, meta, config: publishConfig });
      const existingGuide = await readSafe(path.join(GUIDES_DIR, `${slug}.md`));
      const existingBuyLink = extractFrontmatterString(existingGuide, "buyLink");
      if (!decision.buyLink && isRealExternalLink(existingBuyLink)) {
        decision = decidePublication({
          item,
          meta,
          config: { ...publishConfig, defaultBuyLink: existingBuyLink },
        });
      }
      let paymentLink = {
        provider: "",
        created: false,
        url: "",
        reason: decision.buyLink ? "manual_buy_link_configured" : "not_requested",
      };

      const prodDir = path.join(PRODUCTS_DIR, slug);
      await fs.mkdir(prodDir, { recursive: true });
      const deliveryToken = await getDeliveryToken(prodDir);

      if (!decision.buyLink && !decision.blogDraft && stripeConfig.enabled) {
        console.log("  creating Stripe payment link");
        try {
          paymentLink = await createStripePaymentLink({
            slug,
            title: guideMeta.title,
            description: guideMeta.desc,
            destination: meta.destination,
            deliveryToken,
            siteUrl: SITE_URL,
            config: stripeConfig,
          });
        } catch (err) {
          paymentLink = {
            provider: "stripe",
            created: false,
            url: "",
            reason: "stripe_error",
            error: err?.message || String(err),
          };
        }

        if (paymentLink.url) {
          decision = decidePublication({
            item,
            meta,
            config: { ...publishConfig, defaultBuyLink: paymentLink.url },
          });
        } else if (paymentLink.error) {
          results.errors.push(`${slug}: Stripe payment link failed - ${paymentLink.error}`);
        }
      }

      const guideInfo = generateGuideContent(
        slug,
        research,
        guideOutline,
        meta,
        decision,
        guideMeta
      );
      const checklistInfo = generateChecklistContent(slug, meta, decision);
      const blogContent = blog
        ? applyBlogFrontmatter(blog, {
            destination: meta.destination,
            guideSlug: meta.guideSlug,
            checklistSlug: meta.checklistSlug,
            draft: decision.blogDraft,
          })
        : generateFallbackBlog(meta, decision);

      const pinResult = await writePinAssets({
        outputDir: path.join(prodDir, "pins"),
        socialMarkdown: social,
        context: {
          destination: meta.destination,
          title: guideInfo.title,
          url: `${SITE_URL}/blog/${slug}`,
        },
      });
      const publicPinFiles = await copyPinAssetsToPublic({
        slug,
        pinFiles: pinResult.files,
      });

      const productJson = generateProductJson(
        slug,
        research,
        guideInfo,
        decision,
        pinResult.pins.length,
        paymentLink,
        deliveryToken
      );
      const readme = generateReadme(slug, guideInfo, decision, paymentLink);

      await fs.writeFile(path.join(prodDir, "product.json"), productJson, "utf8");
      console.log(`  wrote automation/products/${slug}/product.json`);
      await writeIfNotExists(
        path.join(prodDir, "guide.md"),
        guideInfo.productContent,
        `automation/products/${slug}/guide.md`
      );
      await writeIfNotExists(
        path.join(prodDir, "checklist.md"),
        checklistInfo.content,
        `automation/products/${slug}/checklist.md`
      );
      await writeIfNotExists(
        path.join(prodDir, "social.md"),
        social || "# Social\n\nA completer.\n",
        `automation/products/${slug}/social.md`
      );
      await fs.writeFile(path.join(prodDir, "README.md"), readme, "utf8");
      console.log(`  wrote automation/products/${slug}/README.md`);

      await writeIfNotExists(
        path.join(GUIDES_DIR, `${slug}.md`),
        guideInfo.content,
        `src/content/guides/${slug}.md`
      );
      await writeIfNotExists(
        path.join(CHECKLISTS_DIR, `${slug}.md`),
        checklistInfo.content,
        `src/content/checklists/${slug}.md`
      );
      await writeIfNotExists(
        path.join(BLOG_DIR, `${slug}.md`),
        blogContent,
        `src/content/blog/${slug}.md`
      );

      results.count++;
      results.products.push({
        slug,
        score: item.score,
        status: decision.status,
        blogDraft: decision.blogDraft,
        guideDraft: decision.guideDraft,
        checklistDraft: decision.checklistDraft,
        paymentProvider: paymentLink.provider,
        paymentLinkCreated: Boolean(paymentLink.created),
        paymentLinkId: paymentLink.id || "",
        deliveryToken,
        pinCount: pinResult.pins.length,
        publicPinFiles,
        files: [
          `automation/products/${slug}/product.json`,
          `automation/products/${slug}/guide.md`,
          `automation/products/${slug}/checklist.md`,
          `automation/products/${slug}/social.md`,
          `automation/products/${slug}/pins/pins.json`,
          `public/pins/${slug}/pins.json`,
          `src/content/guides/${slug}.md`,
          `src/content/checklists/${slug}.md`,
          `src/content/blog/${slug}.md`,
        ],
        missingLinks: [
          decision.buyLink ? "" : "STRIPE_SECRET_KEY_OR_DEFAULT_BUY_LINK",
          decision.formLink ? "" : "DEFAULT_CHECKLIST_FORM_LINK",
        ].filter(Boolean),
      });
    } catch (err) {
      console.error(`  error: ${err.message}`);
      results.errors.push(`${slug}: ${err.message}`);
    }
  }

  summary.productize = results;
  await fs.mkdir(path.dirname(SUMMARY_FILE), { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
  console.log(`\nCreated ${results.count} product pack(s).`);
}

main().catch((err) => {
  console.error("Productize error:", err?.message || err);
  process.exit(0);
});
