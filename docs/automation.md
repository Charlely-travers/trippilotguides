# Automatisation de contenu - V2

TripPilot V2 suit le modele de l'article Mr AI Cash : contenu gratuit pour attirer du trafic, produit guide payant, checklist gratuite pour capturer des emails.

## Ce que fait le pipeline

1. Lit `automation/ideas.json`.
2. Score les idees et produit une recherche structuree dans `automation/research/`.
3. Genere trois brouillons par destination dans `automation/drafts/<slug>/` :
   - `blog.md`
   - `guide-outline.md`
   - `social.md`
4. Relit les brouillons avec `review.mjs`.
5. Si un brouillon est `publish_candidate` avec un score `>= AUTO_PUBLISH_MIN_SCORE` :
   - publie l'article dans `src/content/blog/<slug>.md` avec `draft: false`;
   - cree automatiquement un Stripe Payment Link si `STRIPE_SECRET_KEY` est configure et que `DEFAULT_BUY_LINK` est vide;
   - prepare `src/content/guides/<slug>.md` comme page de vente publique, sans publier le contenu complet du guide;
   - prepare `src/content/checklists/<slug>.md`;
   - genere un pack dans `automation/products/<slug>/`;
   - genere des pins Pinterest SVG/PNG dans `automation/products/<slug>/pins/`;
   - copie les pins publics dans `public/pins/<slug>/`;
   - rend le PDF de livraison dans `public/delivery/<slug>-<token>/guide.pdf` si Playwright est installe.
6. Lance les tests et le build.
7. En GitHub Actions, commit/push les contenus site generes (`src/content`, `public/pins`, `public/delivery`) si les tests et le build passent.
8. Publie les pins sur Pinterest si `PINTEREST_ACCESS_TOKEN` et `PINTEREST_BOARD_ID` sont configures.
9. Envoie un rapport Discord si `DISCORD_WEBHOOK_URL` est configure.

## Regle importante

Les articles peuvent etre publies automatiquement pour construire le trafic.

Les pages guide/checklist ne deviennent publiques que si les vrais liens sont configures ou crees automatiquement :

- `STRIPE_SECRET_KEY` pour creer un lien de paiement Stripe automatiquement.
- `DEFAULT_BUY_LINK` si tu veux forcer un lien d'achat manuel.
- `DEFAULT_CHECKLIST_FORM_LINK` pour la checklist/email.
- ou `INTERNAL_LEAD_MAGNET=true` avec `RESEND_API_KEY` pour utiliser le formulaire interne `/api/lead-magnet`.

Si le lien d'achat est absent et que Stripe n'est pas configure, le guide reste en `draft: true`.
Si le lien checklist est absent, la checklist reste en `draft: true`.
Le site ne montre donc pas de page de vente cassee ni de faux lien Gumroad/Tally.

Le contenu complet du guide reste dans le pack interne `automation/products/<slug>/guide.md`.
La page publique `src/content/guides/<slug>.md` est une page de vente avec le bouton d'achat.

## Livraison apres paiement

Le webhook Stripe est pret dans `api/stripe-webhook.js`.

Pour l'activer en production :

1. Heberge le site sur une plateforme qui supporte les fonctions `/api/*` (par exemple Vercel).
2. Configure un webhook Stripe vers `https://ton-domaine.com/api/stripe-webhook`.
3. Ecoute l'evenement `checkout.session.completed`.
4. Ajoute `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `FULFILLMENT_FROM_EMAIL` et `GUIDE_DELIVERY_BASE_URL` dans les secrets/variables de production.

Le webhook verifie la signature Stripe, lit le slug produit dans les metadata Stripe, puis envoie par email le lien du PDF de livraison.

## Checklist gratuite sans Tally

Si tu ne veux pas creer de formulaire Tally/Brevo, active :

```env
INTERNAL_LEAD_MAGNET=true
RESEND_API_KEY=...
LEAD_MAGNET_FROM_EMAIL=TripPilot Guides <hello@trippilotguides.com>
```

Les checklists generees pointeront vers `/api/lead-magnet?slug=<destination>`.
Le endpoint envoie le lien de checklist par email via Resend.

## Variables

| Variable | Role |
| --- | --- |
| `MISTRAL_API_KEY` | Generation et scoring IA |
| `MISTRAL_MODEL` | Modele blog/social |
| `MISTRAL_RESEARCH_MODEL` | Modele recherche |
| `MISTRAL_GUIDE_MODEL` | Modele guide |
| `GENERATE_COUNT` | Nombre d'idees generees par run |
| `AUTO_PUBLISH_MIN_SCORE` | Seuil de publication, defaut `9` |
| `SITE_URL` | URL publique du site |
| `DEFAULT_BUY_LINK` | Lien d'achat manuel, prioritaire si fourni |
| `STRIPE_SECRET_KEY` | Cle Stripe pour creer les Payment Links automatiquement |
| `STRIPE_WEBHOOK_SECRET` | Secret webhook Stripe pour verifier les paiements |
| `AUTO_CREATE_STRIPE_PAYMENT_LINKS` | Active/desactive Stripe auto, defaut actif si cle presente |
| `STRIPE_PAYMENT_LINK_PRICE_CENTS` | Prix par guide en centimes, defaut `900` |
| `STRIPE_PAYMENT_LINK_CURRENCY` | Devise Stripe, defaut `eur` |
| `STRIPE_PAYMENT_LINK_AUTOMATIC_TAX` | Active Stripe automatic tax si ton compte est configure |
| `STRIPE_PAYMENT_LINK_ALLOW_PROMO_CODES` | Autorise les codes promo Stripe |
| `DEFAULT_CHECKLIST_FORM_LINK` | Lien Tally/MailerLite/Brevo de la checklist |
| `INTERNAL_LEAD_MAGNET` | Utilise `/api/lead-magnet` au lieu d'un formulaire externe |
| `RESEND_API_KEY` | Envoi email guide/checklist via Resend |
| `GUIDE_DELIVERY_BASE_URL` | Base URL des PDFs payants |
| `PINTEREST_ACCESS_TOKEN` | Token Pinterest API v5 |
| `PINTEREST_BOARD_ID` | Board Pinterest de publication |
| `PINTEREST_MAX_PINS_PER_PRODUCT` | Nombre de pins postes par produit |
| `DISCORD_WEBHOOK_URL` | Rapport Discord |

## Lancer en local

```bash
npm ci
npm run automation:research
npm run automation:generate
npm run automation:review
npm run automation:productize
npm run automation:render-pdfs
npm test
npm run build
npm run automation:pinterest
```

Ou tout lancer :

```bash
npm run automation:all
```

Sans `MISTRAL_API_KEY`, la recherche bascule en mode offline et la generation est ignoree. C'est normal pour verifier que le pipeline ne casse pas.

Pour verifier que tes variables ne sont pas des placeholders :

```bash
npm run automation:check-readiness
```

## GitHub Actions

Le workflow `.github/workflows/automation.yml` se lance :

- manuellement avec `workflow_dispatch`;
- automatiquement chaque lundi matin.

Le job a `contents: write` pour pouvoir committer les contenus publies. Il ne commit que si `npm test` et `npm run build` passent. Les packs `automation/products` restent disponibles en artefact GitHub Actions pour eviter de gonfler le depot avec les sources internes.

## Prochaine phase

La V2 genere les assets Pinterest localement, peut creer les liens de paiement Stripe automatiquement, peut rendre les PDFs et peut poster sur Pinterest via API.

Restent obligatoirement manuels une seule fois : creer/activer les comptes externes (Stripe, Resend, Pinterest), recuperer les vraies cles, configurer le webhook Stripe dans le dashboard et remplacer tous les placeholders (`ton-site.com`, `sk_test_...`, etc.).
