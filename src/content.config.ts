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
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, guides, checklists };
