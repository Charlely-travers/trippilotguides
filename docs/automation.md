# Automatisation de contenu — V1

Cette automatisation aide à **préparer** du contenu pour TripPilot Guides à
partir d'une liste d'idées de voyage. Elle **ne publie jamais rien
automatiquement** : tout est produit en brouillon (`draft: true`) et fourni en
artefact à relire.

## Ce qu'elle fait

1. Lit une liste d'idées dans [`automation/ideas.json`](../automation/ideas.json).
2. **Score** chaque idée (Mistral) puis **recherche le web** pour les idées
   retenues (`research.mjs`) et écrit un dossier de recherche structuré par idée
   dans `automation/research/<slug>.json` (destination, angle, sources, attractions
   avec prix indicatifs/URLs, transports, quartiers, restaurants, points
   d'attention, mots-clés SEO/Pinterest, `needsVerification`).
   Architecture à 3 niveaux avec repli : **`web_search`** (Mistral Conversations
   API + outil web_search) → **`model_only`** (modèle seul, tout à vérifier) →
   **`offline`** (squelette sans clé API).
3. **Génère des brouillons** riches **à partir des données de recherche** :
   - un article de blog long (1200-1600 mots) : intro à angle commercial,
     itinéraire jour par jour, budget bas/moyen/confort, erreurs à éviter,
     transports, où dormir, quoi réserver, **encadré « ⚠️ À vérifier avant le
     départ »** (issu de `needsVerification`), **CTA checklist** + **CTA guide
     PDF**, **section Sources**, disclaimer (`blog.md`, `draft: true`),
   - un plan de production de guide PDF (`guide-outline.md`) : structure du PDF,
     pages, tableaux budget, planning matin/midi/après-midi/soir, alternatives
     pluie/fatigue, checklist imprimable, liens à vérifier, visuels Canva,
   - des contenus réseaux sociaux (`social.md`) : 10 idées Pinterest, 10 hooks
     TikTok/Reels, 5 scripts courts (angle émotionnel + CTA).
   La génération **évite toute affirmation certaine non sourcée**.
4. **Relit et note** chaque brouillon sur 10 (`review.mjs`). Statuts :
   `needs_improvement` (< 8), `ok` (≥ 8), `publish_candidate` (≥ 9).
   **Pénalité forte si la recherche n'est pas exploitée** (score plafonné), et
   contrôle de la présence de **sources** et de **liens « à vérifier »**. Repli
   **heuristique** automatique si `MISTRAL_API_KEY` est absente.
5. Lance `npm run build` pour vérifier que le site compile toujours.
6. Envoie un **résumé Discord** : état de la **recherche** (OK/KO + nombre de
   sources), idées scorées, **review** (score moyen, statut, candidats publiables
   ou message « aucun brouillon publiable »), fichiers générés, erreurs, build.

Pipeline : **research → generate → review → build → notify**.

## Principes de sécurité

- **Aucune publication automatique.** Les brouillons sont écrits dans
  `automation/drafts/` — un dossier **hors de `src/content/`** — donc ils ne
  sont ni inclus dans le build ni mis en ligne.
- Le site possède en plus un champ `draft` dans le schéma du blog : un article
  avec `draft: true` n'est ni listé ni rendu, même s'il est placé dans
  `src/content/blog/`.
- Le workflow ne committe rien et ne pousse rien. Les brouillons sont
  récupérables via l'**artefact** `automation-output` de l'exécution.
- En cas d'absence de clé ou d'erreur Mistral, le build et la notification
  s'exécutent quand même (les erreurs sont remontées dans le rapport Discord).

## Configuration

### Secrets GitHub (Settings → Secrets and variables → Actions)

| Secret | Rôle |
| --- | --- |
| `MISTRAL_API_KEY` | Clé API Mistral (obligatoire pour le scoring/génération) |
| `DISCORD_WEBHOOK_URL` | Webhook du salon Discord pour le rapport |

### Variables optionnelles

Voir [`.env.example`](../.env.example) :

- `MISTRAL_MODEL` (défaut `mistral-small-latest`)
- `MISTRAL_RESEARCH_MODEL` (modèle de recherche web, défaut = `MISTRAL_MODEL`)
- `GENERATE_COUNT` (nombre d'idées recherchées puis transformées en brouillons, défaut `1`)

## Lancer le workflow

1. Onglet **Actions** du dépôt GitHub.
2. Workflow **« Automatisation contenu (V1) »**.
3. Bouton **Run workflow** (déclenchement manuel `workflow_dispatch`).
4. Renseigner éventuellement `generate_count` et `model`, puis lancer.
5. À la fin : consulter le message Discord et télécharger l'artefact
   `automation-output` pour relire les brouillons.

## Lancer en local

```bash
# Node 22 requis (Astro 6)
nvm use 22

# Variables (PowerShell / bash) ou fichier .env exporté
export MISTRAL_API_KEY="votre_cle"
export DISCORD_WEBHOOK_URL="votre_webhook"   # optionnel en local

npm run automation:research   # recherche web -> automation/research/*.json + summary.json
npm run automation:generate   # brouillons (depuis la recherche) -> automation/drafts
npm run automation:review     # note les brouillons /10 -> review.json + summary.review
npm run build                 # vérifie la compilation
BUILD_STATUS=success npm run automation:notify   # envoie le rapport Discord

# ou tout enchaîner (research -> generate -> review -> build -> notify) :
npm run automation:all
```

Les brouillons apparaissent dans `automation/drafts/<slug>/` :
`blog.md`, `guide-outline.md`, `social.md`.

## Promouvoir un brouillon en article publié

1. Relire et corriger `automation/drafts/<slug>/blog.md`.
2. Le déplacer dans `src/content/blog/<slug>.md`.
3. Vérifier le frontmatter (titre, description, `pubDate`, `emoji`, `gradient`,
   `readingTime`).
4. Passer `draft: true` à `draft: false` (ou retirer la ligne).
5. `npm run build` puis commit/push manuel.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `automation/ideas.json` | Liste d'idées en entrée |
| `automation/research.mjs` | Recherche web structurée (web_search → modèle → hors-ligne) |
| `automation/generate.mjs` | Génération des brouillons à partir de la recherche |
| `automation/review.mjs` | Relecture + note /10 (pénalise si recherche non utilisée) |
| `automation/notify.mjs` | Envoi du rapport Discord |
| `automation/research/` | Dossiers de recherche par idée (généré) |
| `automation/output/summary.json` | Résumé machine (généré, inclut `research` + `review`) |
| `automation/output/review.json` | Détail de la relecture (généré) |
| `automation/drafts/` | Brouillons générés (jamais publiés) |
| `.github/workflows/automation.yml` | Workflow GitHub Actions manuel |

## Recherche web (Mistral `web_search`)

`research.mjs` utilise l'API **Conversations** de Mistral (beta) avec l'outil
intégré `web_search` :

```
POST https://api.mistral.ai/v1/conversations
{ "model": "mistral-small-latest", "inputs": "…", "tools": [{ "type": "web_search" }] }
```

Les sources réelles sont extraites des chunks `tool_reference` de la réponse.
Si l'API/outil n'est pas disponible, le script bascule automatiquement sur une
recherche basée modèle (`model_only`, tout marqué à vérifier), puis sur un
squelette `offline` sans clé — sans jamais interrompre le pipeline.

## Limites de la V1

- Pas de publication ni de commit automatique (volontaire).
- Les contenus générés par IA doivent être **relus** : prix, horaires et faits
  doivent être vérifiés avant toute mise en ligne.
- Un seul appel de scoring + un appel de génération par idée (coût maîtrisé).
