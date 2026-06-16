import test from "node:test";
import assert from "node:assert/strict";

import { deliveryFolderName, markdownToDeliveryHtml } from "../lib/delivery-pdf.mjs";

test("creates a tokenized delivery folder name", () => {
  assert.equal(deliveryFolderName("Lisbonne Guide", "abc123"), "lisbonne-guide-abc123");
});

test("converts basic markdown into delivery HTML", () => {
  const html = markdownToDeliveryHtml({
    title: "Porto en 3 jours",
    markdown: "# Porto\n\n## Jour 1\n\n- Arriver\n- Manger",
  });

  assert.match(html, /<h1>Porto<\/h1>/);
  assert.match(html, /<h2>Jour 1<\/h2>/);
  assert.match(html, /<li>Arriver<\/li>/);
  assert.match(html, /TripPilot Guides/);
});
