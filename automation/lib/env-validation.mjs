const PLACEHOLDER_PATTERNS = [
  /^$/,
  /\.\.\./,
  /todo/i,
  /placeholder/i,
  /example/i,
  /ton-/i,
  /ta-/i,
  /your-/i,
  /change-me/i,
  /replace-me/i,
  /<[^>]+>/,
];

export function isPlaceholderValue(value) {
  const text = String(value || "").trim();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

export function isUsableStripeSecretKey(value) {
  const key = String(value || "").trim();
  if (isPlaceholderValue(key)) return false;
  return /^sk_(test|live)_[A-Za-z0-9_]{10,}$/.test(key);
}

export function isUsableUrl(value, { allowRelative = false } = {}) {
  const url = String(value || "").trim();
  if (isPlaceholderValue(url)) return false;
  if (allowRelative && url.startsWith("/")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function getReadinessReport(env = process.env) {
  const blockers = [];
  const warnings = [];

  if (!isUsableUrl(env.SITE_URL)) blockers.push("SITE_URL_PLACEHOLDER");

  if (isPlaceholderValue(env.MISTRAL_API_KEY)) {
    blockers.push("MISTRAL_API_KEY_MISSING_OR_PLACEHOLDER");
  }

  const hasManualBuyLink = isUsableUrl(env.DEFAULT_BUY_LINK);
  const hasStripe = isUsableStripeSecretKey(env.STRIPE_SECRET_KEY);
  if (!hasManualBuyLink && !hasStripe) {
    blockers.push(
      isPlaceholderValue(env.STRIPE_SECRET_KEY)
        ? "STRIPE_SECRET_KEY_PLACEHOLDER"
        : "STRIPE_SECRET_KEY_MISSING"
    );
  }

  const hasExternalChecklist = isUsableUrl(env.DEFAULT_CHECKLIST_FORM_LINK);
  const hasInternalChecklist =
    /^true$/i.test(String(env.INTERNAL_LEAD_MAGNET || "").trim()) &&
    !isPlaceholderValue(env.RESEND_API_KEY) &&
    isUsableUrl(env.SITE_URL);
  if (!hasExternalChecklist && !hasInternalChecklist) {
    blockers.push(
      isPlaceholderValue(env.DEFAULT_CHECKLIST_FORM_LINK)
        ? "CHECKLIST_FORM_LINK_PLACEHOLDER"
        : "CHECKLIST_FORM_LINK_MISSING"
    );
  }

  if (isPlaceholderValue(env.PINTEREST_ACCESS_TOKEN)) {
    warnings.push("PINTEREST_ACCESS_TOKEN_MISSING_OR_PLACEHOLDER");
  }
  if (isPlaceholderValue(env.PINTEREST_BOARD_ID)) {
    warnings.push("PINTEREST_BOARD_ID_MISSING_OR_PLACEHOLDER");
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
  };
}
