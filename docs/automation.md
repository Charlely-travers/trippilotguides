# Automatisation de contenu — V1

Cette automatisation aide à **préparer** du contenu pour TripPilot Guides à
partir d'une liste d'idées de voyage. Elle **ne publie jamais rien
automatiquement** : tout est produit en brouillon (`draft: true`) et fourni en
artefact à relire.

## Ce qu'elle fait

1. Lit une liste d'idées dans [`automation/ideas.json`](../automation/ideas.json).
2. **Score** chaque idée avec l'API **Mistral** (potentiel SEO, monétisation, facilité).
3. **Génère des brouillons** pour les idées les mieux notées :
   - un article de blog (`blog.md`, avec `draft: true`),
   - un plan de guide PDF (`guide-outline.md`),
   - des posts pour réseaux sociaux (`social.md`).
4. Lance `npm run build` pour vérifier que le site compile toujours.
5. Envoie un **résumé Discord** : idées scorées, fichiers générés, erreurs, statut du build.

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
- `GENERATE_COUNT` (nombre d'idées transformées en brouillons, défaut `1`)

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

npm run automation:generate   # scoring + brouillons -> automation/drafts + summary.json
npm run build                 # vérifie la compilation
BUILD_STATUS=success npm run automation:notify   # envoie le rapport Discord
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
| `automation/generate.mjs` | Scoring Mistral + génération des brouillons |
| `automation/notify.mjs` | Envoi du rapport Discord |
| `automation/output/summary.json` | Résumé machine (généré) |
| `automation/drafts/` | Brouillons générés (jamais publiés) |
| `.github/workflows/automation.yml` | Workflow GitHub Actions manuel |

## Limites de la V1

- Pas de publication ni de commit automatique (volontaire).
- Les contenus générés par IA doivent être **relus** : prix, horaires et faits
  doivent être vérifiés avant toute mise en ligne.
- Un seul appel de scoring + un appel de génération par idée (coût maîtrisé).
