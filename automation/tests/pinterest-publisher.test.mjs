import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPinterestPinPayload,
  getPinterestConfig,
  publishPinterestPin,
} from "../lib/pinterest-publisher.mjs";

test("does not enable Pinterest posting with placeholder credentials", () => {
  const config = getPinterestConfig({
    PINTEREST_ACCESS_TOKEN: "...",
    PINTEREST_BOARD_ID: "your-board-id",
    SITE_URL: "https://ton-site.com",
  });

  assert.equal(config.enabled, false);
  assert.ok(config.blockers.includes("PINTEREST_ACCESS_TOKEN_PLACEHOLDER"));
  assert.ok(config.blockers.includes("PINTEREST_BOARD_ID_PLACEHOLDER"));
  assert.ok(config.blockers.includes("SITE_URL_PLACEHOLDER"));
});

test("builds a Pinterest Create Pin payload using public image URLs", () => {
  const payload = buildPinterestPinPayload({
    boardId: "123456789",
    title: "Lisbonne en 4 jours",
    description: "Itineraire, budget et checklist.",
    link: "https://trippilotguides.com/blog/lisbonne",
    imageUrl: "https://trippilotguides.com/pins/lisbonne/pin-01.png",
  });

  assert.equal(payload.board_id, "123456789");
  assert.equal(payload.link, "https://trippilotguides.com/blog/lisbonne");
  assert.deepEqual(payload.media_source, {
    source_type: "image_url",
    url: "https://trippilotguides.com/pins/lisbonne/pin-01.png",
    is_standard: true,
  });
});

test("publishes a Pinterest pin through the v5 API", async () => {
  const calls = [];
  const result = await publishPinterestPin({
    config: {
      enabled: true,
      accessToken: "pina_1234567890",
      boardId: "123456789",
      apiBaseUrl: "https://api.pinterest.com/v5",
    },
    pin: {
      title: "Porto en 3 jours",
      description: "Guide pratique.",
      link: "https://trippilotguides.com/blog/porto",
      imageUrl: "https://trippilotguides.com/pins/porto/pin-1.png",
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: "987654321", url: "https://pinterest.com/pin/987654321" }),
      };
    },
  });

  assert.equal(result.created, true);
  assert.equal(result.id, "987654321");
  assert.equal(calls[0].url, "https://api.pinterest.com/v5/pins");
  assert.equal(calls[0].options.headers.Authorization, "Bearer pina_1234567890");
});
