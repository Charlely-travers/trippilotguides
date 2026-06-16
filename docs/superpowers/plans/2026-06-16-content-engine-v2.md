# Content Engine V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish high-quality traffic articles automatically while preparing paid guide and checklist product files safely.

**Architecture:** Add small automation helper modules with Node tests, then wire them into the existing V1 scripts and Astro pages. Keep the existing research/generate/review flow, and make `productize.mjs` responsible for V2 publication decisions.

**Tech Stack:** Astro 6, Node 22 ESM scripts, Node built-in test runner, Sharp for local Pinterest PNG rendering, GitHub Actions.

---

### Task 1: Publication Rules

**Files:**
- Create: `automation/lib/publish-rules.mjs`
- Test: `automation/tests/publish-rules.test.mjs`
- Modify: `package.json`

- [ ] Add tests for publishing a blog when status is `publish_candidate` and score is at least 9.
- [ ] Add tests proving guides/checklists remain drafts when external links are missing or placeholder-like.
- [ ] Implement `getPublishConfig`, `isRealExternalLink`, `decidePublication`, `deriveDestinationMeta`, and `applyBlogFrontmatter`.
- [ ] Add `npm test` using `node --test automation/tests/*.test.mjs`.

### Task 2: Pinterest Pin Assets

**Files:**
- Create: `automation/lib/pin-assets.mjs`
- Test: `automation/tests/pin-assets.test.mjs`
- Modify: `package.json`

- [ ] Add tests for SVG escaping, 1000x1500 output, and a 10-pin fallback set.
- [ ] Implement deterministic pin data extraction from `social.md`.
- [ ] Render SVG and PNG assets under `automation/products/<slug>/pins/`.
- [ ] Add direct `sharp` dependency so the renderer does not rely on transitive packages.

### Task 3: Productize V2

**Files:**
- Modify: `automation/productize.mjs`
- Modify: `.env.example`

- [ ] Import publication and pin helpers.
- [ ] Publish only the blog to `src/content/blog/<slug>.md` when quality passes.
- [ ] Create guide/checklist files with `draft: false` only when real buy/form links exist.
- [ ] Generate `product.json`, `README.md`, and pins with explicit statuses.
- [ ] Prevent overwriting existing content files.

### Task 4: Destination-Aware Blog CTAs

**Files:**
- Modify: `src/content.config.ts`
- Modify: `src/pages/blog/[...slug].astro`
- Modify: existing blog markdown frontmatter where useful.

- [ ] Add optional `destination`, `guideSlug`, and `checklistSlug` to blog schema.
- [ ] Resolve published guide/checklist availability from content collections.
- [ ] Replace hard-coded Rome CTA with destination-aware CTA.
- [ ] Fall back to `/guides` when destination product is not public.

### Task 5: Workflow Auto-Commit

**Files:**
- Modify: `.github/workflows/automation.yml`
- Modify: `docs/automation.md`

- [ ] Change permissions to `contents: write`.
- [ ] Add a post-build commit step that stages generated `src/content`, `automation/products`, and `public/generated` when changed.
- [ ] Keep artifact upload and Discord notification.
- [ ] Document the V2 behavior and optional monetization variables.

### Task 6: Verification

**Commands:**
- `npm test`
- `npm run build`
- `npm run automation:all` without API keys to verify graceful no-op

- [ ] Confirm tests pass.
- [ ] Confirm build passes.
- [ ] Confirm automation handles missing `MISTRAL_API_KEY` without publishing junk.

