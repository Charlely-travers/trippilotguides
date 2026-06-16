// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Remplace cette URL par ton domaine définitif (utile pour le SEO / sitemap / canonical).
// Tailwind CSS v4 est intégré via PostCSS (voir postcss.config.mjs) pour
// rester compatible avec le moteur Vite/Rolldown d'Astro 6.
export default defineConfig({
  site: "https://trippilotguides.com",
  integrations: [sitemap()],
});
