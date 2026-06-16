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
  }),
});

export const collections = { blog };
