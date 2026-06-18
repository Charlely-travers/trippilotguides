import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFallbackPins,
  extractPinterestPins,
  renderPinOverlaySvg,
} from "../lib/pin-assets.mjs";

test("creates ten fallback pins for a destination", () => {
  const pins = buildFallbackPins({
    destination: "Lisbonne",
    title: "Lisbonne en 4 jours avec un budget de 550€",
    url: "https://trippilotguides.com/blog/lisbonne",
  });

  assert.equal(pins.length, 10);
  assert.equal(pins[0].destination, "Lisbonne");
  assert.match(pins[0].overlayText, /Lisbonne/i);
  assert.equal(pins[0].url, "https://trippilotguides.com/blog/lisbonne");
});

test("extracts numbered Pinterest ideas from social markdown", () => {
  const md = [
    "# Posts social",
    "",
    "## 📌 Idées Pinterest (10)",
    "",
    "1. Lisbonne en 4 jours sans exploser le budget #lisbonne",
    "2. Où dormir à Lisbonne pour tout faire à pied #portugal",
    "",
    "## 🎬 Hooks TikTok / Reels",
    "1. Stoppe ton scroll.",
  ].join("\n");

  const pins = extractPinterestPins(md, {
    destination: "Lisbonne",
    title: "Lisbonne en 4 jours",
    url: "https://trippilotguides.com/blog/lisbonne",
  });

  assert.equal(pins.length, 2);
  assert.equal(pins[0].title, "Lisbonne en 4 jours sans exploser le budget");
  assert.deepEqual(pins[0].tags, ["lisbonne"]);
});

test("renders a 1000x1500 overlay SVG and escapes title text", () => {
  const svg = renderPinOverlaySvg({
    destination: "Porto",
    title: "Porto <budget>",
    overlayText: "Porto & budget",
    description: "Guide pratique",
    tags: ["porto"],
    url: "https://trippilotguides.com/blog/porto",
  });

  assert.match(svg, /width="1000"/);
  assert.match(svg, /height="1500"/);
  assert.match(svg, /Porto &lt;budget&gt;/);
  assert.doesNotMatch(svg, /Porto <budget>/);
});

