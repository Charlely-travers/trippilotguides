/**
 * Renders paid guide/checklist product packs into PDF files under public/delivery.
 * Uses Playwright when available; exits cleanly if Chromium is not installed.
 */

import "./lib/load-env.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  deliveryFolderName,
  markdownToDeliveryHtml,
} from "./lib/delivery-pdf.mjs";

const ROOT = process.cwd();
const PRODUCTS_DIR = path.join(ROOT, "automation", "products");
const PUBLIC_DELIVERY_DIR = path.join(ROOT, "public", "delivery");
const SUMMARY_FILE = path.join(ROOT, "automation", "output", "summary.json");

async function readJsonSafe(filepath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filepath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readSafe(filepath) {
  try {
    return await fs.readFile(filepath, "utf8");
  } catch {
    return "";
  }
}

async function productSlugs() {
  const summary = await readJsonSafe(SUMMARY_FILE, {});
  const products = summary?.productize?.products || [];
  return products.map((product) => product.slug).filter(Boolean);
}

async function writeSummaryDelivery(delivery) {
  const summary = await readJsonSafe(SUMMARY_FILE, {});
  summary.delivery = delivery;
  await fs.mkdir(path.dirname(SUMMARY_FILE), { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    const delivery = { rendered: 0, skipped: true, reason: "playwright_not_installed" };
    await writeSummaryDelivery(delivery);
    console.log("Delivery PDFs skipped: Playwright is not installed.");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const rendered = [];

  for (const slug of await productSlugs()) {
    const productDir = path.join(PRODUCTS_DIR, slug);
    const product = await readJsonSafe(path.join(productDir, "product.json"), {});
    const guideMd = await readSafe(path.join(productDir, "guide.md"));
    if (!guideMd) continue;

    const folder = deliveryFolderName(slug, product.deliveryToken || "");
    const targetDir = path.join(PUBLIC_DELIVERY_DIR, folder);
    await fs.mkdir(targetDir, { recursive: true });

    // Render guide PDF
    const targetPdf = path.join(targetDir, "guide.pdf");
    await page.setContent(
      markdownToDeliveryHtml({
        title: product.title || slug,
        markdown: guideMd,
      }),
      { waitUntil: "networkidle" }
    );
    await page.pdf({
      path: targetPdf,
      format: "A4",
      printBackground: true,
    });
    rendered.push(path.relative(ROOT, targetPdf).replace(/\\/g, "/"));

    // Render checklist PDF (free lead magnet)
    const checklistMd = await readSafe(path.join(productDir, "checklist.md"));
    if (checklistMd) {
      const checklistPdf = path.join(targetDir, "checklist.pdf");
      await page.setContent(
        markdownToDeliveryHtml({
          title: `Checklist gratuite — ${product.title || slug}`,
          markdown: checklistMd,
        }),
        { waitUntil: "networkidle" }
      );
      await page.pdf({
        path: checklistPdf,
        format: "A4",
        printBackground: true,
      });
      rendered.push(path.relative(ROOT, checklistPdf).replace(/\\/g, "/"));
    }
  }

  await browser.close();
  const delivery = { rendered: rendered.length, files: rendered };
  await writeSummaryDelivery(delivery);
  console.log(`Delivery PDFs rendered: ${rendered.length}`);
}

main().catch(async (err) => {
  await writeSummaryDelivery({
    rendered: 0,
    skipped: true,
    reason: err?.message || String(err),
  });
  console.error("Delivery PDF render error:", err?.message || err);
  process.exit(0);
});
