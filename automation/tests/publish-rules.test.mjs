import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBlogFrontmatter,
  decidePublication,
  deriveDestinationMeta,
  isRealExternalLink,
} from "../lib/publish-rules.mjs";

test("publishes blog and guide page when a candidate has no monetization links", () => {
  const meta = deriveDestinationMeta({
    slug: "cracovie",
    research: {
      destination: "Cracovie",
      idea: "Cracovie en 3 jours : histoire et petits prix",
    },
  });

  const decision = decidePublication({
    item: { status: "publish_candidate", score: 9.2 },
    meta,
    config: { minScore: 9, defaultBuyLink: "", defaultChecklistFormLink: "" },
  });

  assert.equal(decision.blogDraft, false);
  // Le guide se publie même sans lien de paiement (la page gère "Acheter bientôt").
  assert.equal(decision.guideDraft, false);
  // La checklist reste en draft tant qu'aucun formulaire n'est configuré.
  assert.equal(decision.checklistDraft, true);
  assert.equal(decision.buyLink, "");
  assert.equal(decision.formLink, "");
  assert.equal(decision.status, "traffic_published_products_draft");
});

test("publishes guide and checklist when real external links are configured", () => {
  const meta = deriveDestinationMeta({
    slug: "lisbonne",
    research: {
      destination: "Lisbonne",
      idea: "Lisbonne en 4 jours avec un budget de 550€",
    },
  });

  const decision = decidePublication({
    item: { status: "publish_candidate", score: 9 },
    meta,
    config: {
      minScore: 9,
      defaultBuyLink: "https://payhip.com/b/lisbonne-guide",
      defaultChecklistFormLink: "https://tally.so/r/abc123",
    },
  });

  assert.equal(decision.blogDraft, false);
  assert.equal(decision.guideDraft, false);
  assert.equal(decision.checklistDraft, false);
  assert.equal(decision.status, "full_funnel_published");
});

test("publishes checklist when internal lead magnet endpoint is enabled", () => {
  const meta = deriveDestinationMeta({
    slug: "porto",
    research: {
      destination: "Porto",
      idea: "Porto en 3 jours",
    },
  });

  const decision = decidePublication({
    item: { status: "publish_candidate", score: 9 },
    meta,
    config: {
      minScore: 9,
      defaultBuyLink: "https://buy.stripe.com/test_123",
      defaultChecklistFormLink: "/api/lead-magnet",
    },
  });

  assert.equal(decision.guideDraft, false);
  assert.equal(decision.checklistDraft, false);
  assert.equal(decision.formLink, "/api/lead-magnet");
});

test("rejects placeholders as real external links", () => {
  assert.equal(isRealExternalLink("TODO_GUMROAD_OR_PAYHIP_LINK"), false);
  assert.equal(isRealExternalLink("https://gumroad.com/l/rome-guide-placeholder"), false);
  assert.equal(isRealExternalLink("https://tally.so/r/placeholder"), false);
  assert.equal(isRealExternalLink("https://example.com/real-product"), true);
});

test("adds destination-aware frontmatter and publishes the blog", () => {
  const source = [
    "---",
    'title: "Cracovie en 3 jours"',
    'description: "Un itinéraire pratique."',
    "pubDate: 2026-06-16",
    "draft: true",
    "---",
    "",
    "## Itinéraire",
    "",
    "Contenu.",
  ].join("\n");

  const updated = applyBlogFrontmatter(source, {
    destination: "Cracovie",
    guideSlug: "cracovie",
    checklistSlug: "cracovie",
    draft: false,
  });

  assert.match(updated, /^destination: "Cracovie"$/m);
  assert.match(updated, /^guideSlug: "cracovie"$/m);
  assert.match(updated, /^checklistSlug: "cracovie"$/m);
  assert.match(updated, /^draft: false$/m);
  assert.doesNotMatch(updated, /^draft: true$/m);
});
