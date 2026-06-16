/**
 * TripPilot Guides — Notification Discord de l'automatisation.
 *
 * Lit automation/output/summary.json (produit par generate.mjs) et l'état du
 * build (variable d'environnement BUILD_STATUS), puis envoie un embed Discord
 * via DISCORD_WEBHOOK_URL.
 *
 * Aucune dépendance externe (fetch natif).
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SUMMARY_FILE = path.join(ROOT, "automation", "output", "summary.json");

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const BUILD_STATUS = (process.env.BUILD_STATUS || "unknown").toLowerCase();
const RUN_URL = process.env.RUN_URL || "";

const COLORS = { success: 0x22c55e, failure: 0xef4444, unknown: 0x6366f1 };

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

async function readSummary() {
  try {
    const raw = await fs.readFile(SUMMARY_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildPayload(summary) {
  const buildOk = BUILD_STATUS === "success";
  const color = COLORS[BUILD_STATUS] ?? COLORS.unknown;

  const fields = [];

  // Idées scorées (top 5)
  if (summary?.scored?.length) {
    const top = summary.scored
      .slice(0, 5)
      .map(
        (r, i) =>
          `**${i + 1}.** ${truncate(r.idea, 70)} — \`${r.score}/100\`${
            r.raison ? `\n   _${truncate(r.raison, 90)}_` : ""
          }`
      )
      .join("\n");
    fields.push({ name: "🧭 Idées scorées", value: truncate(top, 1024) });
  } else {
    fields.push({
      name: "🧭 Idées scorées",
      value: "Aucune (scoring non exécuté).",
    });
  }

  // Fichiers générés
  if (summary?.generatedFiles?.length) {
    const files = summary.generatedFiles.map((f) => `• \`${f}\``).join("\n");
    fields.push({
      name: `📝 Brouillons générés (${summary.generatedFiles.length})`,
      value: truncate(files, 1024),
    });
  } else {
    fields.push({ name: "📝 Brouillons générés", value: "Aucun." });
  }

  // Recherche web
  const research = summary?.research;
  if (research) {
    const ok = (research.succeeded || 0) > 0;
    const total = research.totalSources || 0;
    const value =
      `${ok ? "✅ OK" : "🚫 KO"} · Méthode : ${research.method || "n/a"} · ` +
      `Recherches : ${research.succeeded || 0}/${research.requested || 0} · ` +
      `Sources : \`${total}\``;
    fields.push({ name: "🔍 Recherche web", value: truncate(value, 1024) });
  }

  // Build
  fields.push({
    name: "🏗️ Build",
    value: buildOk ? "✅ Réussi (`npm run build`)" : `❌ ${BUILD_STATUS}`,
    inline: true,
  });

  // Review qualité des brouillons
  const review = summary?.review;
  if (review && Array.isArray(review.items) && review.items.length) {
    const publishable = Number(review.publishCandidateCount || 0);
    const header =
      `Score moyen : \`${review.averageScore}/10\` · ` +
      `🚀 Publiables : \`${publishable}\` · ` +
      `⚠️ À améliorer : \`${review.needsImprovementCount}\` · ` +
      `Méthode : ${review.method}`;
    fields.push({ name: "🔎 Review IA", value: truncate(header, 1024) });

    // Message clair si aucun brouillon n'est publiable
    fields.push({
      name: "🚦 Publication",
      value:
        publishable > 0
          ? `✅ ${publishable} brouillon(s) candidat(s) à la publication (score ≥ 9). À relire avant mise en ligne.`
          : "🚫 Aucun brouillon publiable pour l'instant (aucun score ≥ 9). Relecture/amélioration nécessaire.",
    });

    const icon = (s) =>
      s === "publish_candidate" ? "🚀" : s === "ok" ? "✅" : "⚠️";
    const lines = review.items
      .slice(0, 5)
      .map((it) => {
        const weak =
          it.status !== "publish_candidate" && it.weaknesses?.length
            ? `\n   _${truncate(it.weaknesses[0], 90)}_`
            : "";
        return `${icon(it.status)} ${truncate(it.slug, 50)} — \`${it.score}/10\` (${it.status})${weak}`;
      })
      .join("\n");
    fields.push({
      name: "📊 Score par brouillon",
      value: truncate(lines, 1024),
    });

    // Complétude des brouillons (fichiers manquants / social cassé)
    const issues = review.items
      .filter((it) => it.complete === false || it.socialBroken)
      .map((it) => {
        const flags = [];
        if (it.socialBroken) flags.push("social.md contient `[object Object]`");
        if (Array.isArray(it.missingFiles) && it.missingFiles.length)
          flags.push(`manque ${it.missingFiles.join(", ")}`);
        if (!flags.length) flags.push("brouillon incomplet");
        return `⚠️ ${truncate(it.slug, 40)} — ${flags.join(" · ")}`;
      });
    fields.push({
      name: "🧩 Complétude",
      value: issues.length
        ? truncate(issues.join("\n"), 1024)
        : "✅ Tous les brouillons sont complets (blog + guide + social, sans [object Object]).",
    });
  } else if (review) {
    fields.push({
      name: "🔎 Review IA",
      value: "Aucun brouillon à évaluer.",
    });
  }

  // Erreurs
  const errors = summary?.errors ?? [];
  fields.push({
    name: `⚠️ Erreurs (${errors.length})`,
    value: errors.length
      ? truncate(errors.map((e) => `• ${e}`).join("\n"), 1024)
      : "Aucune",
  });

  const description =
    "Exécution de l'automatisation de contenu (scoring + brouillons). " +
    "**Aucune publication automatique** : les brouillons sont en `draft: true` et disponibles en artefact." +
    (RUN_URL ? `\n[Voir l'exécution](${RUN_URL})` : "");

  return {
    username: "TripPilot Automation",
    embeds: [
      {
        title: "🤖 Rapport d'automatisation — TripPilot Guides",
        description: truncate(description, 4000),
        color,
        fields,
        footer: { text: `Modèle : ${summary?.model || "n/a"}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

async function main() {
  const summary = await readSummary();

  if (!WEBHOOK) {
    console.log(
      "DISCORD_WEBHOOK_URL absente : notification ignorée. Résumé :"
    );
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const payload = buildPayload(summary);
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`Échec webhook Discord : HTTP ${res.status} — ${text.slice(0, 200)}`);
    process.exit(1);
  }
  console.log("Notification Discord envoyée.");
}

main().catch((err) => {
  console.error("Erreur notify :", err?.message || err);
  // Ne bloque pas le workflow sur l'échec de notification.
  process.exit(0);
});
