/**
 * Script utilitaire — Récupère la liste de tes tableaux Pinterest + leur ID.
 * Usage : node --env-file=.env automation/pinterest-get-boards.mjs
 */

const TOKEN = process.env.PINTEREST_ACCESS_TOKEN;
const API_BASE = "https://api-sandbox.pinterest.com/v5";

if (!TOKEN) {
  console.error("❌ PINTEREST_ACCESS_TOKEN manquant dans .env");
  process.exit(1);
}

async function main() {
  console.log("🔍 Récupération de tes tableaux Pinterest (Sandbox)...\n");

  const res = await fetch(`${API_BASE}/boards`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ Erreur Pinterest API : HTTP ${res.status}`);
    console.error(text);
    if (res.status === 401) {
      console.error("\n→ Token invalide ou expiré. Regénère-le sur developers.pinterest.com.");
    }
    process.exit(1);
  }

  const data = await res.json();
  const boards = data.items || [];

  if (!boards.length) {
    console.log("Aucun tableau trouvé.");
    console.log("→ Crée d'abord un tableau sur pinterest.com, puis relance ce script.");
    process.exit(0);
  }

  console.log(`✅ ${boards.length} tableau(x) trouvé(s) :\n`);
  console.log("─".repeat(60));
  for (const b of boards) {
    console.log(`  Nom   : ${b.name}`);
    console.log(`  ID    : ${b.id}`);
    console.log(`  URL   : https://www.pinterest.com${b.url || ""}`);
    console.log("─".repeat(60));
  }

  console.log(`\n👉 Copie l'ID du tableau que tu veux utiliser et ajoute dans .env :`);
  console.log(`   PINTEREST_BOARD_ID=${boards[0].id}`);
}

main().catch((err) => {
  console.error("Erreur :", err.message);
  process.exit(1);
});
