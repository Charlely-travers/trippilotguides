import fs from "node:fs/promises";
import path from "node:path";
import { isPlaceholderValue, isUsableUrl } from "./env-validation.mjs";

const DEFAULT_API_BASE_URL = "https://api.pinterest.com/v5";

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPinterestConfig(env = process.env) {
  const accessToken = String(env.PINTEREST_ACCESS_TOKEN || "").trim();
  const boardId = String(env.PINTEREST_BOARD_ID || "").trim();
  const siteUrl = String(env.SITE_URL || "").replace(/\/$/, "");
  const blockers = [];

  if (isPlaceholderValue(accessToken)) blockers.push("PINTEREST_ACCESS_TOKEN_PLACEHOLDER");
  if (isPlaceholderValue(boardId) || /your|board-id/i.test(boardId)) {
    blockers.push("PINTEREST_BOARD_ID_PLACEHOLDER");
  }
  if (!isUsableUrl(siteUrl)) blockers.push("SITE_URL_PLACEHOLDER");

  return {
    enabled: blockers.length === 0,
    blockers,
    accessToken,
    boardId,
    siteUrl,
    apiBaseUrl: String(env.PINTEREST_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, ""),
    maxPinsPerProduct: positiveInt(env.PINTEREST_MAX_PINS_PER_PRODUCT, 3),
  };
}

export function buildPinterestPinPayload({ boardId, title, description, link, imageUrl }) {
  return {
    board_id: boardId,
    title: String(title || "").slice(0, 100),
    description: String(description || "").slice(0, 500),
    link,
    media_source: {
      source_type: "image_url",
      url: imageUrl,
      is_standard: true,
    },
  };
}

export async function publishPinterestPin({
  config = getPinterestConfig(),
  pin,
  fetchImpl = globalThis.fetch,
}) {
  if (!config.enabled) {
    return { created: false, skipped: true, reason: "pinterest_not_configured" };
  }
  if (typeof fetchImpl !== "function") {
    return { created: false, skipped: true, reason: "fetch_unavailable" };
  }

  const payload = buildPinterestPinPayload({
    boardId: config.boardId,
    title: pin.title,
    description: pin.description,
    link: pin.link,
    imageUrl: pin.imageUrl,
  });

  const response = await fetchImpl(`${config.apiBaseUrl}/pins`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      created: false,
      skipped: false,
      reason: "pinterest_error",
      status: response.status,
      error: body?.message || body?.error?.message || `Pinterest HTTP ${response.status}`,
    };
  }

  return {
    created: true,
    skipped: false,
    id: body.id,
    url: body.url || (body.id ? `https://www.pinterest.com/pin/${body.id}` : ""),
  };
}

export function toPublicPinItems({ slug, pins, siteUrl, maxPins = 3 }) {
  return (pins || []).slice(0, maxPins).map((pin, index) => {
    const number = pin.number || index + 1;
    const filenameNumber = String(number).padStart(2, "0");
    return {
      title: pin.title || `${slug} - guide voyage`,
      description: pin.description || "Guide pratique TripPilot Guides.",
      link: `${siteUrl}/blog/${slug}`,
      imageUrl: `${siteUrl}/pins/${slug}/pin-${filenameNumber}.png`,
      number,
    };
  });
}

export async function readProductPins(productDir) {
  const pinsPath = path.join(productDir, "pins", "pins.json");
  try {
    const raw = await fs.readFile(pinsPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
