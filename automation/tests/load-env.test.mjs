import test from "node:test";
import assert from "node:assert/strict";

import { parseDotenv } from "../lib/load-env.mjs";

test("parses dotenv values without exposing comments", () => {
  const parsed = parseDotenv([
    "# comment",
    "MISTRAL_API_KEY=abc123",
    "SITE_URL=\"https://trippilotguides.com\"",
    "EMPTY=",
  ].join("\n"));

  assert.equal(parsed.MISTRAL_API_KEY, "abc123");
  assert.equal(parsed.SITE_URL, "https://trippilotguides.com");
  assert.equal(parsed.EMPTY, "");
});
