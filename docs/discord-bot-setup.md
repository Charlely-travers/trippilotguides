# Bot Discord — TripPilot Guides

Pilote toute la pipeline de génération depuis Discord : ajouter une destination, déclencher le workflow, voir les résultats.

## Commandes

| Commande | Description |
|---|---|
| `/pipeline <ville> [jours] [budget]` | Ajoute une ville à `ideas.json` et déclenche la pipeline GitHub Actions |
| `/publish` | Déclenche le workflow manuellement (sans ajouter de nouvelle ville) |
| `/status` | Affiche le résumé de la dernière exécution (score, erreurs, PDFs…) |
| `/list` | Liste les villes actives avec leur score et statut |
| `/ideas` | Affiche les idées en attente |

## Mise en place (15 min)

### 1. Créer le bot Discord

1. Va sur https://discord.com/developers/applications
2. **New Application** → nomme-la « TripPilot Bot »
3. Onglet **Bot** → **Reset Token** → copie le token
4. Coche les intents : aucun intent privilégié requis (le bot utilise les slash commands)
5. Onglet **OAuth2 → URL Generator** :
   - Scopes : `bot`, `applications.commands`
   - Bot Permissions : `Send Messages`, `Embed Links`, `Use Slash Commands`
6. Copie l'URL et ouvre-la dans ton navigateur pour inviter le bot sur ton serveur Discord

### 2. Variables d'environnement

Ajoute dans ton `.env` (ou le service d'hébergement du bot) :

```
DISCORD_BOT_TOKEN=<token copié à l'étape 1>
DISCORD_GUILD_ID=<clic droit sur ton serveur → Copier l'identifiant>
GITHUB_TOKEN=<Personal Access Token avec scope "workflow">
GITHUB_REPO=ton-compte/trippilotguides
```

Le `GITHUB_TOKEN` se crée sur https://github.com/settings/tokens → **Generate new token (classic)** → coche **workflow**.

### 3. Lancer le bot

**En local (test)** :
```bash
npm install discord.js
node automation/discord-bot.mjs
```

**En prod (recommandé : Railway ou Render)** :
- Fork ou push ton repo
- Ajoute un service « Worker » (pas un web service)
- Start command : `node automation/discord-bot.mjs`
- Variables d'env : les 4 ci-dessus + celles habituelles (MISTRAL, etc.)

Le bot tourne en continu et répond aux slash commands. Le workflow lourd (génération IA, build) tourne sur GitHub Actions (pas sur le bot).

### 4. Flux complet

```
Toi sur Discord : /pipeline Lisbonne 4 500
         ↓
Bot : ajoute "Lisbonne en 4 jours" à ideas.json
Bot : déclenche GitHub Actions (workflow_dispatch)
         ↓
GitHub Actions : research → generate → review → productize → render PDFs → build → commit/push → Pinterest → notify
         ↓
Discord webhook (#pipeline-log) : rapport complet avec score, liens, erreurs
         ↓
Vercel : redéploie automatiquement sur push (site à jour)
```

Tu n'as rien à faire à part taper une commande.

## Architecture

```
┌──────────┐     slash cmd      ┌────────────────────┐
│ Discord  │ ──────────────────→│ discord-bot.mjs    │
│ (toi)    │ ←──────────────────│ (Railway/Render)   │
└──────────┘     embed réponse  └────────┬───────────┘
                                         │ workflow_dispatch (API GitHub)
                                         ▼
                                ┌────────────────────┐
                                │ GitHub Actions      │
                                │ (automation.yml)    │
                                │ research → ... →    │
                                │ build → pinterest   │
                                └────────┬───────────┘
                                         │ git push
                                         ▼
                                ┌────────────────────┐
                                │ Vercel             │
                                │ (auto-deploy)      │
                                └────────────────────┘
                                         │
                                         ▼
                                ┌────────────────────┐
                                │ Discord webhook     │
                                │ (notify.mjs)        │
                                │ → #pipeline-log     │
                                └────────────────────┘
```
