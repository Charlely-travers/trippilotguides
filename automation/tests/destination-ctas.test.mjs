import test from "node:test";
import assert from "node:assert/strict";

import { resolveBlogCtas } from "../../src/lib/destination-ctas.mjs";

test("does not send an unpublished generated destination to the Rome guide", () => {
  const ctas = resolveBlogCtas({
    postId: "cracovie",
    postData: {
      title: "Cracovie en 3 jours",
      destination: "Cracovie",
      guideSlug: "cracovie",
      checklistSlug: "cracovie",
    },
    publishedGuides: [],
    publishedChecklists: [],
    legacyGuides: [{ slug: "rome-5-jours-budget-700", title: "Rome en 5 jours", price: "9€" }],
  });

  assert.equal(ctas.destination, "Cracovie");
  assert.equal(ctas.top.href, "/guides");
  assert.equal(ctas.guide.href, "/guides");
  assert.equal(ctas.guide.available, false);
});

test("uses published generated guide and checklist when available", () => {
  const ctas = resolveBlogCtas({
    postId: "lisbonne",
    postData: {
      title: "Lisbonne en 4 jours",
      destination: "Lisbonne",
      guideSlug: "lisbonne",
      checklistSlug: "lisbonne",
    },
    publishedGuides: [{ slug: "lisbonne", title: "Lisbonne en 4 jours - guide complet", price: "9€" }],
    publishedChecklists: [{ slug: "lisbonne", title: "Checklist gratuite - Lisbonne" }],
    legacyGuides: [],
  });

  assert.equal(ctas.top.href, "/checklists/lisbonne");
  assert.equal(ctas.guide.href, "/guides/lisbonne");
  assert.equal(ctas.guide.available, true);
});

test("keeps existing Rome content connected to the legacy Rome guide", () => {
  const ctas = resolveBlogCtas({
    postId: "budget-rome-5-jours",
    postData: {
      title: "Quel budget prévoir pour 5 jours à Rome ?",
    },
    publishedGuides: [],
    publishedChecklists: [],
    legacyGuides: [{ slug: "rome-5-jours-budget-700", title: "Rome en 5 jours - budget 700€", price: "9€" }],
    legacyChecklistHref: "/checklist-rome-gratuite",
  });

  assert.equal(ctas.destination, "Rome");
  assert.equal(ctas.top.href, "/checklist-rome-gratuite");
  assert.equal(ctas.guide.href, "/guides/rome-5-jours-budget-700");
  assert.equal(ctas.guide.available, true);
});

