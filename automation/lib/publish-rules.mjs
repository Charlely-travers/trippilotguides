const PLACEHOLDER_RE = /(?:^$|todo|placeholder|ton-|ta-|your-|\.\.\.|gumroad\.com\/l\/.*placeholder|tally\.so\/r\/placeholder)/i;

export function getPublishConfig(env = process.env) {
  const parsed = Number(env.AUTO_PUBLISH_MIN_SCORE || 9);
  const internalLeadMagnet = /^true$/i.test(String(env.INTERNAL_LEAD_MAGNET || "").trim());
  return {
    minScore: Number.isFinite(parsed) && parsed > 0 ? parsed : 9,
    defaultBuyLink: String(env.DEFAULT_BUY_LINK || env.BUY_LINK || "").trim(),
    defaultChecklistFormLink: String(
      env.DEFAULT_CHECKLIST_FORM_LINK ||
        env.CHECKLIST_FORM_LINK ||
        (internalLeadMagnet ? "/api/lead-magnet" : "")
    ).trim(),
  };
}

export function isRealExternalLink(value) {
  const link = String(value || "").trim();
  if (PLACEHOLDER_RE.test(link)) return false;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isInternalActionLink(value) {
  const link = String(value || "").trim();
  if (PLACEHOLDER_RE.test(link)) return false;
  return link.startsWith("/api/");
}

export function slugify(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

export function guessDestination(idea, fallback = "") {
  const match = String(idea || "").match(/^([A-ZÀ-Ÿ][\p{L}'’ -]+?)\s+(?:en|le|la|pour|à|:|\d)/u);
  return (match ? match[1] : String(idea || fallback).split(/[,:]/)[0]).trim();
}

export function guessDuration(idea) {
  const match = String(idea || "").match(/(\d+)\s*jours?/i);
  return match ? `${match[1]} jours` : "";
}

export function deriveDestinationMeta({ slug, research = {} }) {
  const destination = String(
    research.destination || guessDestination(research.idea, slug) || slug
  ).trim();
  const cleanSlug = slugify(slug || destination);
  return {
    slug: cleanSlug,
    destination,
    duration: guessDuration(research.idea),
    guideSlug: cleanSlug,
    checklistSlug: cleanSlug,
  };
}

export function decidePublication({ item, meta, config = getPublishConfig() }) {
  const score = Number(item?.score || 0);
  const isCandidate = item?.status === "publish_candidate" && score >= config.minScore;
  const buyLink = isRealExternalLink(config.defaultBuyLink) ? config.defaultBuyLink : "";
  const formLink = isRealExternalLink(config.defaultChecklistFormLink) ||
    isInternalActionLink(config.defaultChecklistFormLink)
    ? config.defaultChecklistFormLink
    : "";

  const blogDraft = !isCandidate;
  // Le guide se publie dès qu'il est candidat : la page gère l'absence de lien
  // de paiement ("Acheter bientôt" + checklist). Le lien Stripe reste optionnel.
  const guideDraft = !isCandidate;
  const checklistDraft = !isCandidate || !formLink;
  const status = !isCandidate
    ? "not_publishable"
    : buyLink && formLink
      ? "full_funnel_published"
      : "traffic_published_products_draft";

  return {
    status,
    slug: meta.slug,
    destination: meta.destination,
    guideSlug: meta.guideSlug,
    checklistSlug: meta.checklistSlug,
    score,
    blogDraft,
    guideDraft,
    checklistDraft,
    buyLink,
    formLink,
  };
}

function quoteYaml(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatFrontmatterValue(value) {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return quoteYaml(value);
}

function splitMarkdown(md) {
  const text = String(md || "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: "", body: text };
  return { frontmatter: match[1], body: text.slice(match[0].length) };
}

export function applyBlogFrontmatter(markdown, updates) {
  const { frontmatter, body } = splitMarkdown(markdown);
  const next = new Map(
    Object.entries({
      destination: updates.destination,
      guideSlug: updates.guideSlug,
      checklistSlug: updates.checklistSlug,
      draft: updates.draft,
    }).filter(([, value]) => value !== undefined && value !== null)
  );

  const seen = new Set();
  const lines = frontmatter
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const key = line.match(/^([A-Za-z][A-Za-z0-9_-]*):/)?.[1];
      if (!key || !next.has(key)) return line;
      seen.add(key);
      return `${key}: ${formatFrontmatterValue(next.get(key))}`;
    });

  for (const [key, value] of next) {
    if (!seen.has(key)) lines.push(`${key}: ${formatFrontmatterValue(value)}`);
  }

  return `---\n${lines.join("\n")}\n---\n${body.startsWith("\n") ? body : `\n${body}`}`;
}
