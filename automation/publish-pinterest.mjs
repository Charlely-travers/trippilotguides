/**
 * Publishes generated public pin images to Pinterest.
 *
 * Requires:
 * - PINTEREST_ACCESS_TOKEN
 * - PINTEREST_BOARD_ID
 * - SITE_URL
 */

import "./lib/load-env.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  getPinterestConfig,
  publishPinterestPin,
  readProductPins,
  toPublicPinItems,
} from "./lib/pinterest-publisher.mjs";

const ROOT = process.cwd();
const PRODUCTS_DIR = path.join(ROOT, "automation", "products");
const SUMMARY_FILE = path.join(ROOT, "automation", "output", "summary.json");
const STATE_FILE = path.join(ROOT, "automation", "published-pins.json");

async function readJsonSafe(filepath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filepath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filepath, data) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(data, null, 2), "utf8");
}

async function productSlugsFromSummary() {
  const summary = await readJsonSafe(SUMMARY_FILE, {});
  const products = summary?.productize?.products || [];
  return products.map((product) => product.slug).filter(Boolean);
}

async function main() {
  const config = getPinterestConfig();
  const summary = await readJsonSafe(SUMMARY_FILE, {});
  const state = await readJsonSafe(STATE_FILE, { pins: [] });
  const known = new Set((state.pins || []).map((pin) => pin.key));
  const slugs = await productSlugsFromSummary();
  const results = [];

  if (!config.enabled) {
    console.log("=== Pinterest ===");
    console.log(`Skipped: ${config.blockers.join(", ") || "not configured"}`);
    summary.pinterest = { enabled: false, posted: 0, skipped: true, blockers: config.blockers };
    await writeJson(SUMMARY_FILE, summary);
    return;
  }

  for (const slug of slugs) {
    const productDir = path.join(PRODUCTS_DIR, slug);
    const pins = await readProductPins(productDir);
    const items = toPublicPinItems({
      slug,
      pins,
      siteUrl: config.siteUrl,
      maxPins: config.maxPinsPerProduct,
    });

    for (const item of items) {
      const key = `${slug}:${item.number}`;
      if (known.has(key)) {
        results.push({ key, slug, skipped: true, reason: "already_published" });
        continue;
      }

      const result = await publishPinterestPin({ config, pin: item });
      results.push({ key, slug, ...result });
      if (result.created) {
        known.add(key);
        state.pins.push({
          key,
          slug,
          number: item.number,
          pinId: result.id,
          url: result.url,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  await writeJson(STATE_FILE, state);
  summary.pinterest = {
    enabled: true,
    posted: results.filter((result) => result.created).length,
    results,
  };
  await writeJson(SUMMARY_FILE, summary);
  console.log(`Pinterest pins posted: ${summary.pinterest.posted}`);
}

main().catch(async (err) => {
  const summary = await readJsonSafe(SUMMARY_FILE, {});
  summary.pinterest = {
    enabled: false,
    posted: 0,
    error: err?.message || String(err),
  };
  await writeJson(SUMMARY_FILE, summary);
  console.error("Pinterest publish error:", err?.message || err);
  process.exit(0);
});
