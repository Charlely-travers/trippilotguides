# TripPilot Content Engine V2 Design

## Goal

Build a low-cost automation loop that follows the Mr AI Cash travel strategy: publish traffic content automatically, prepare paid travel products, and avoid broken public funnels while payment and email links are not configured.

## Scope

The V2 publishes blog articles automatically when the review score is at least 9 and the draft is a `publish_candidate`. It generates product material for paid guides and free lead-magnet checklists, but public guide/checklist pages remain drafts unless real external links are configured.

Pinterest posting is not connected in this phase. The system generates local Pinterest pin assets for each publishable article so a later phase can post them through Pinterest API or a social scheduler.

## Product Model

Generated destinations have three content surfaces:

- Blog article: free traffic asset, auto-published when quality passes.
- Paid guide page: money product, published only when a real buy link exists.
- Free checklist page: lead magnet, published only when a real form/email link exists.

If buy/form links are missing, the product files are still created in `src/content` as drafts and in `automation/products/<slug>/`, but users never see broken `TODO_*` or placeholder payment links.

## Data Flow

`research.mjs` creates factual input. `generate.mjs` creates draft content. `review.mjs` assigns a status and score. `productize.mjs` applies V2 publication rules, writes the blog to `src/content/blog/<slug>.md` with `draft: false`, writes guide/checklist content with safe draft states, generates product metadata, and renders Pinterest pin images.

## Site Behavior

Blog frontmatter gains `destination`, `guideSlug`, and `checklistSlug`. The blog page uses these fields to render destination-aware CTAs. If a destination product is not public yet, the article links to the guide index instead of a broken product page.

Existing Rome pages remain available. Generated blog posts no longer hard-code Rome CTAs.

## Configuration

The free-to-operate default requires only `MISTRAL_API_KEY` for AI generation. Optional variables enable monetization:

- `DEFAULT_BUY_LINK`: real Gumroad, Payhip, or Etsy product URL.
- `DEFAULT_CHECKLIST_FORM_LINK`: real Tally, MailerLite, Brevo, or similar form URL.
- `AUTO_PUBLISH_MIN_SCORE`: default `9`.

## Safety

Automation never publishes guide/checklist pages with placeholder links. Existing content files are not overwritten. GitHub Actions commits generated site content only after build succeeds.

