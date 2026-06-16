import fs from "node:fs";
import path from "node:path";

export function parseDotenv(raw) {
  const values = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}

export function loadDotenv({ cwd = process.cwd(), filename = ".env" } = {}) {
  const filepath = path.join(cwd, filename);
  if (!fs.existsSync(filepath)) return { loaded: false, values: {} };
  const values = parseDotenv(fs.readFileSync(filepath, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return { loaded: true, values };
}

loadDotenv();
