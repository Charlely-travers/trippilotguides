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
  computeGuidePrice,
} from "./lib/publish-rules.mjs";
import { writePinAssets } from "./lib/pin-assets.mjs";
import { fetchCityImage } from "./lib/city-image.mjs";
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
const PUBLIC_DIR = path.join(ROOT, "public");

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

async function getDeliveryToken(prodDir, slug = "") {
  const existing = await readJsonSafe(path.join(prodDir, "product.json"), {});
  if (existing?.deliveryToken) return String(existing.deliveryToken);
  // Token DÉTERMINISTE par ville : stable entre régénérations.
  // Garantit que le PDF (dossier slug-token) et les métadonnées Stripe coïncident,
  // et que la clé d'idempotence Stripe reste valide.
  const salt =
    process.env.DELIVERY_TOKEN_SALT || process.env.STRIPE_WEBHOOK_SECRET || "trippilot-delivery";
  return crypto
    .createHash("sha256")
    .update(`${slug}:${salt}`)
    .digest("hex")
    .slice(0, 18);
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

function generateGuideContent(slug, research, guideOutline, meta, decision, guideMeta, extras = {}) {
  const { title, desc } = guideMeta;
  const dest = meta.destination;
  const durationLabel = meta.duration ? ` en ${meta.duration}` : "";
  const price = extras.price || "9€";
  const img = extras.image || {};
  const fm = [
    "---",
    `title: ${q(title)}`,
    `description: ${q(desc)}`,
    `destination: ${q(meta.destination)}`,
    `duration: ${q(meta.duration)}`,
    `budget: ""`,
    `price: ${q(price)}`,
    `emoji: "📍"`,
    `gradient: "from-brand-500 via-accent-500 to-accent-600"`,
    `buyLink: ${q(decision.buyLink)}`,
    `checklistLink: "/checklists/${slug}"`,
    ...(img.hero ? [`image: ${q(img.hero)}`] : []),
    ...(img.card ? [`cardImage: ${q(img.card)}`] : []),
    ...(img.credit ? [`imageCredit: ${q(img.credit)}`] : []),
    `draft: ${decision.guideDraft}`,
    "---",
  ].join("\n");
  const landingBody = [
    "## Ce que contient le guide",
    "",
    `- **Itinéraire${durationLabel} jour par jour**, découpé matin / après-midi / soir`,
    "- **Budget détaillé** poste par poste, avec 3 niveaux (routard, équilibré, confort)",
    "- **Quartiers où dormir** selon ton budget et ton style de voyage",
    "- **Transports** : depuis l'aéroport et sur place, avec les bons réflexes",
    "- **Bonnes adresses et erreurs à éviter** pour un premier voyage réussi",
    "- **Checklist imprimable** pour préparer ton départ sans rien oublier",
    "",
    "## Pour qui est ce guide ?",
    "",
    `Ce guide est pensé pour préparer un voyage à ${dest} sans passer des heures à comparer des dizaines d'onglets. Que tu partes en couple, entre amis ou en solo, tout est expliqué pas à pas.`,
    "",
    "## Livraison",
    "",
    "C'est un PDF numérique, lisible sur téléphone, tablette ou ordinateur, et conçu pour rester clair une fois imprimé. Tu le reçois après l'achat.",
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

function generateChecklistContent(slug, meta, decision, extras = {}) {
  const dest = meta.destination;
  const title = `Checklist gratuite - ${dest}`;
  const desc = `Téléchargez une checklist complète et imprimable pour préparer votre voyage à ${dest} sans rien oublier : documents, argent, transport, santé et valise.`;
  const img = extras.image || {};
  const formLink =
    decision.formLink === "/api/lead-magnet"
      ? `/api/lead-magnet?slug=${encodeURIComponent(slug)}`
      : decision.formLink;
  const fm = [
    "---",
    `title: ${q(title)}`,
    `description: ${q(desc)}`,
    `destination: ${q(dest)}`,
    `emoji: "📝"`,
    `gradient: "from-emerald-400 via-teal-400 to-cyan-500"`,
    `formLink: ${q(formLink)}`,
    `guideSlug: ${q(slug)}`,
    ...(img.hero ? [`image: ${q(img.hero)}`] : []),
    ...(img.card ? [`cardImage: ${q(img.card)}`] : []),
    ...(img.credit ? [`imageCredit: ${q(img.credit)}`] : []),
    `draft: ${decision.checklistDraft}`,
    "---",
  ].join("\n");
  const body = [
    `Votre checklist imprimable pour préparer votre voyage à ${dest} sereinement. Cochez chaque élément au fur et à mesure : vous ne risquez plus rien d'oublier.`,
    "",
    "## 1 mois avant le départ",
    "",
    "- [ ] Vérifier la validité du passeport / de la carte d'identité (6 mois après le retour)",
    "- [ ] Vérifier si un visa ou une autorisation est nécessaire",
    "- [ ] Réserver vols et hébergement",
    "- [ ] Souscrire une assurance voyage / vérifier les garanties de la carte bancaire",
    "- [ ] Réserver les sites et activités à forte affluence",
    "- [ ] Commander une carte bancaire sans frais à l'étranger si besoin",
    "",
    "## 1 semaine avant",
    "",
    "- [ ] Faire le check-in en ligne et enregistrer les cartes d'embarquement",
    "- [ ] Télécharger les billets, réservations et confirmations (hors-ligne)",
    "- [ ] Enregistrer l'adresse du logement et l'itinéraire depuis l'aéroport",
    "- [ ] Prévenir la banque d'un voyage à l'étranger",
    "- [ ] Télécharger les cartes hors-ligne et les applis utiles (transport, traduction)",
    "- [ ] Retirer un peu d'espèces en devise locale",
    "- [ ] Vérifier la météo et adapter la valise",
    "",
    "## Documents à emporter",
    "",
    "- [ ] Passeport / carte d'identité",
    "- [ ] Billets d'avion + réservations (papier ou mobile)",
    "- [ ] Attestation d'assurance et numéros d'urgence",
    "- [ ] Carte européenne d'assurance maladie (si applicable)",
    "- [ ] Copies / photos des documents importants (séparées des originaux)",
    "- [ ] Permis de conduire (international si location de voiture)",
    "",
    "## Argent & téléphone",
    "",
    "- [ ] Carte bancaire + une carte de secours",
    "- [ ] Espèces en devise locale",
    "- [ ] Téléphone + chargeur + batterie externe",
    "- [ ] Adaptateur de prise si nécessaire",
    "- [ ] Forfait international ou eSIM activé",
    "",
    "## Valise (à adapter à la météo)",
    "",
    "- [ ] Vêtements selon la saison et la durée",
    "- [ ] Chaussures de marche confortables",
    "- [ ] Trousse de toilette (format cabine si bagage à main)",
    "- [ ] Médicaments personnels + petite trousse de premiers soins",
    "- [ ] Lunettes de soleil, crème solaire, gourde réutilisable",
    "",
    "## La veille / le jour du départ",
    "",
    "- [ ] Recharger tous les appareils",
    "- [ ] Vérifier l'heure d'embarquement et le terminal",
    "- [ ] Fermer eau / gaz / fenêtres et débrancher les appareils",
    "- [ ] Laisser une copie de l'itinéraire à un proche",
    "- [ ] Vérifier les restrictions de bagages de la compagnie",
    "",
    "---",
    "",
    `**Envie d'aller plus loin ?** Le guide PDF complet ${dest} contient l'itinéraire jour par jour, le budget détaillé et les bonnes adresses. [Voir le guide ${dest}](/guides/${slug}).`,
  ].join("\n");
  return { content: `${fm}\n\n${body}\n`, title, desc, dest };
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
      const price = computeGuidePrice({ duration: meta.duration });

      // Récupère une vraie photo de la ville (Openverse/Wikipedia) -> public/images/cities
      let cityImage = { ok: false };
      try {
        cityImage = await fetchCityImage({
          destination: meta.destination,
          slug,
          publicDir: PUBLIC_DIR,
        });
        console.log(
          cityImage.ok
            ? `  city image: ${cityImage.hero}`
            : `  city image: fallback (${cityImage.reason})`
        );
      } catch (err) {
        console.log(`  city image error: ${err.message}`);
      }
      const imageExtras = cityImage.ok
        ? { hero: cityImage.hero, card: cityImage.card, credit: cityImage.credit }
        : {};

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
      const deliveryToken = await getDeliveryToken(prodDir, slug);

      if (!decision.buyLink && !decision.blogDraft && stripeConfig.enabled) {
        console.log(`  creating Stripe payment link (${price.label})`);
        try {
          paymentLink = await createStripePaymentLink({
            slug,
            title: guideMeta.title,
            description: guideMeta.desc,
            destination: meta.destination,
            deliveryToken,
            siteUrl: SITE_URL,
            config: { ...stripeConfig, unitAmount: price.cents },
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
        guideMeta,
        { price: price.label, image: imageExtras }
      );
      const checklistInfo = generateChecklistContent(slug, meta, decision, {
        image: imageExtras,
      });
      const blogContent = blog
        ? applyBlogFrontmatter(blog, {
            destination: meta.destination,
            guideSlug: meta.guideSlug,
            checklistSlug: meta.checklistSlug,
            image: imageExtras.hero,
            cardImage: imageExtras.card,
            imageCredit: imageExtras.credit,
            draft: decision.blogDraft,
          })
        : generateFallbackBlog(meta, decision);

      const pinResult = await writePinAssets({
        outputDir: path.join(prodDir, "pins"),
        socialMarkdown: social,
        backgroundImage: cityImage.ok ? path.join(PUBLIC_DIR, cityImage.hero.replace(/^\//, "")) : null,
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
