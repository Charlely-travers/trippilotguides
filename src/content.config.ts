import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    emoji: z.string().default("📍"),
    gradient: z.string().default("from-brand-500 to-accent-600"),
    readingTime: z.string().default("6 min"),
    destination: z.string().optional(),
    guideSlug: z.string().optional(),
    checklistSlug: z.string().optional(),
    /** Image hero locale (ex: /images/cities/<slug>-hero.webp) */
    image: z.string().optional(),
    /** Image carte locale (ex: /images/cities/<slug>-card.webp) */
    cardImage: z.string().optional(),
    /** Crédit / attribution de la photo */
    imageCredit: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const guides = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/guides" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    destination: z.string(),
    duration: z.string().default(""),
    budget: z.string().default(""),
    price: z.string().default("9€"),
    emoji: z.string().default("📍"),
    gradient: z.string().default("from-brand-500 to-accent-600"),
    buyLink: z.string().default("TODO_GUMROAD_OR_PAYHIP_LINK"),
    checklistLink: z.string().default(""),
    image: z.string().optional(),
    cardImage: z.string().optional(),
    imageCredit: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const checklists = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/checklists" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    destination: z.string(),
    emoji: z.string().default("📝"),
    gradient: z.string().default("from-emerald-400 to-cyan-500"),
    formLink: z.string().default("TODO_TALLY_OR_MAILERLITE_LINK"),
    guideSlug: z.string().default(""),
    image: z.string().optional(),
    cardImage: z.string().optional(),
    imageCredit: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, guides, checklists };
