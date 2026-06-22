/**
 * TripPilot Guides — Bot Discord pour piloter la pipeline automatisée.
 *
 * Commandes slash :
 *   /pipeline <ville> [jours] [budget] — Ajoute une ville et lance la pipeline
 *   /status                            — État de la dernière exécution
 *   /list                              — Villes actives (avec leur score/statut)
 *   /publish                           — Déclenche le workflow GitHub Actions
 *   /ideas                             — Affiche les idées en attente
 *
 * Prérequis :
 *   - DISCORD_BOT_TOKEN (token du bot)
 *   - DISCORD_GUILD_ID (ID du serveur Discord)
 *   - GITHUB_TOKEN (personal access token avec scope workflow)
 *   - GITHUB_REPO (format owner/repo, ex: moncompte/trippilotguides)
 *
 * Hébergement léger : Railway, Render, ou un VPS. Tourne en continu.
 * Installer : npm install discord.js
 */

import "./lib/load-env.mjs";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const IDEAS_FILE = path.join(ROOT, "automation", "ideas.json");
const SUMMARY_FILE = path.join(ROOT, "automation", "output", "summary.json");
const RESEARCH_DIR = path.join(ROOT, "automation", "research");

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || "";

if (!DISCORD_TOKEN) {
  console.error("DISCORD_BOT_TOKEN manquant. Le bot ne peut pas démarrer.");
  process.exit(1);
}

// ----- Helpers -----

function slugify(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

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

/** Déclenche le workflow GitHub Actions via l'API REST. */
async function triggerGitHubWorkflow(generateCount = 1, targetIdea = "") {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return { ok: false, reason: "GITHUB_TOKEN ou GITHUB_REPO non configuré." };
  }
  const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/automation.yml/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: { generate_count: String(generateCount), target_idea: targetIdea || "" },
    }),
  });
  if (res.status === 204) return { ok: true };
  const body = await res.text().catch(() => "");
  return { ok: false, reason: `GitHub ${res.status}: ${body.slice(0, 200)}` };
}

// ----- Discord setup -----

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = await import("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("pipeline")
    .setDescription("Ajoute une destination et lance la pipeline de génération")
    .addStringOption((o) => o.setName("ville").setDescription("Nom de la ville").setRequired(true))
    .addIntegerOption((o) => o.setName("jours").setDescription("Nombre de jours (3-10)").setMinValue(3).setMaxValue(10))
    .addIntegerOption((o) => o.setName("budget").setDescription("Budget total en € (ex: 700)").setMinValue(200).setMaxValue(5000)),
  new SlashCommandBuilder()
    .setName("publish")
    .setDescription("Déclenche le workflow GitHub Actions (pipeline complète sur le cloud)"),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Affiche l'état de la dernière exécution de la pipeline"),
  new SlashCommandBuilder()
    .setName("list")
    .setDescription("Liste les villes actives avec leur score et statut"),
  new SlashCommandBuilder()
    .setName("ideas")
    .setDescription("Affiche les idées en attente dans ideas.json"),
];

// Register slash commands
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
try {
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands((await rest.get(Routes.user())).id, GUILD_ID), {
      body: commands.map((c) => c.toJSON()),
    });
  } else {
    await rest.put(Routes.applicationCommands((await rest.get(Routes.user())).id), {
      body: commands.map((c) => c.toJSON()),
    });
  }
  console.log("Commandes slash enregistrées.");
} catch (err) {
  console.error("Erreur registration commandes :", err?.message || err);
}

// ----- Client -----

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("ready", () => {
  console.log(`Bot Discord connecté : ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case "pipeline":
        await handlePipeline(interaction);
        break;
      case "publish":
        await handlePublish(interaction);
        break;
      case "status":
        await handleStatus(interaction);
        break;
      case "list":
        await handleList(interaction);
        break;
      case "ideas":
        await handleIdeas(interaction);
        break;
    }
  } catch (err) {
    const msg = `Erreur : ${err?.message || err}`;
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

// ----- Command handlers -----

async function handlePipeline(interaction) {
  await interaction.deferReply();
  const ville = interaction.options.getString("ville");
  const jours = interaction.options.getInteger("jours") || 5;
  const budget = interaction.options.getInteger("budget");

  const idea = budget
    ? `${ville} en ${jours} jours : découvertes et budget ${budget}€`
    : `${ville} en ${jours} jours : découvertes, quartiers et budget`;

  // Ajoute l'idée
  const ideas = await readJsonSafe(IDEAS_FILE, { ideas: [] });
  if (!ideas.ideas.some((i) => i.toLowerCase().includes(ville.toLowerCase()))) {
    ideas.ideas.push(idea);
    await writeJson(IDEAS_FILE, ideas);
  }

  // Déclenche GitHub Actions en CIBLANT cette ville précise.
  const result = await triggerGitHubWorkflow(1, idea);
  const embed = new EmbedBuilder()
    .setTitle("🚀 Pipeline lancée")
    .setColor(result.ok ? 0x22c55e : 0xf59e0b)
    .addFields(
      { name: "Destination", value: `**${ville}** (${jours} jours)`, inline: true },
      { name: "Idée ciblée", value: idea },
      { name: "GitHub Actions", value: result.ok ? "✅ Workflow déclenché (cette ville uniquement)" : `⚠️ ${result.reason}` }
    )
    .setFooter({ text: "TripPilot Automation" })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handlePublish(interaction) {
  await interaction.deferReply();
  const result = await triggerGitHubWorkflow(1);
  const embed = new EmbedBuilder()
    .setTitle("⚡ Workflow déclenché")
    .setColor(result.ok ? 0x22c55e : 0xef4444)
    .setDescription(result.ok ? "Le workflow GitHub Actions a été lancé." : `Erreur : ${result.reason}`)
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleStatus(interaction) {
  const summary = await readJsonSafe(SUMMARY_FILE, null);
  if (!summary) {
    return interaction.reply({ content: "Aucune exécution trouvée (pas de summary.json).", ephemeral: true });
  }

  const review = summary?.review;
  const productize = summary?.productize;
  const delivery = summary?.delivery;
  const errors = summary?.errors || [];

  const embed = new EmbedBuilder()
    .setTitle("📊 État de la dernière pipeline")
    .setColor(errors.length ? 0xf59e0b : 0x22c55e)
    .addFields(
      { name: "Brouillons générés", value: `${summary?.generatedFiles?.length || 0}`, inline: true },
      { name: "Score moyen", value: review ? `${review.averageScore}/10` : "—", inline: true },
      { name: "Produits", value: `${productize?.count || 0}`, inline: true },
      { name: "PDFs rendus", value: `${delivery?.rendered || 0}`, inline: true },
      { name: "Erreurs", value: errors.length ? errors.slice(0, 3).join("\n") : "Aucune" }
    )
    .setTimestamp();
  await interaction.reply({ embeds: [embed] });
}

async function handleList(interaction) {
  let cities = [];
  try {
    const files = await fs.readdir(RESEARCH_DIR);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const data = await readJsonSafe(path.join(RESEARCH_DIR, f), {});
      cities.push({
        slug: f.replace(".json", ""),
        destination: data.destination || f.replace(".json", ""),
        attractions: data.attractions?.length || 0,
      });
    }
  } catch {
    /* no research dir */
  }

  if (!cities.length) {
    return interaction.reply({ content: "Aucune ville en base de recherche.", ephemeral: true });
  }

  // Enrichir avec le score du dernier review
  const summary = await readJsonSafe(SUMMARY_FILE, {});
  const reviewItems = summary?.review?.items || [];
  const prodItems = summary?.productize?.products || [];

  const lines = cities.map((c) => {
    const rev = reviewItems.find((r) => r.slug === c.slug);
    const prod = prodItems.find((p) => p.slug === c.slug);
    const score = rev ? `${rev.score}/10` : "—";
    const status = prod ? prod.status : rev?.status || "research";
    return `• **${c.destination}** — Score: \`${score}\` · Statut: ${status} · ${c.attractions} attractions`;
  });

  const embed = new EmbedBuilder()
    .setTitle("🌍 Villes actives")
    .setColor(0x6366f1)
    .setDescription(lines.join("\n"))
    .setTimestamp();
  await interaction.reply({ embeds: [embed] });
}

async function handleIdeas(interaction) {
  const ideas = await readJsonSafe(IDEAS_FILE, { ideas: [] });
  const list = ideas.ideas.length
    ? ideas.ideas.map((i, n) => `${n + 1}. ${i}`).join("\n")
    : "Aucune idée en attente.";
  const embed = new EmbedBuilder()
    .setTitle("💡 Idées en attente")
    .setColor(0x818cf8)
    .setDescription(list)
    .setTimestamp();
  await interaction.reply({ embeds: [embed] });
}

// ----- Start -----

client.login(DISCORD_TOKEN);
