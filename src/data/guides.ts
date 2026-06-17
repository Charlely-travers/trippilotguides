/**
 * Données des guides de voyage.
 *
 * Source unique de vérité pour la liste de guides affichée sur /guides.
 * Les guides publiés dans la content collection (src/content/guides/) sont
 * automatiquement fusionnés ici au build-time pour éviter les doublons.
 *
 * Pour ajouter une destination, il suffit de créer un fichier .md dans
 * src/content/guides/ avec draft: false — elle apparaîtra automatiquement.
 */

export type GuideStatus = "available" | "coming-soon";

export interface Guide {
  slug: string;
  destination: string;
  title: string;
  duration: string;
  budget: string;
  audience: string;
  status: GuideStatus;
  price: string;
  gradient: string;
  emoji: string;
  excerpt: string;
}

/**
 * Guides "statiques" qui ne sont pas encore dans la content collection.
 * Dès qu'un guide passe dans src/content/guides/ avec draft: false,
 * il est automatiquement ajouté à la liste via mergeWithCollection().
 */
export const staticGuides: Guide[] = [
  {
    slug: "rome-5-jours-budget-700",
    destination: "Rome",
    title: "Rome en 5 jours — budget 700€",
    duration: "5 jours",
    budget: "≈ 700€",
    audience: "Premier voyage, couple ou solo",
    status: "available",
    price: "9€",
    gradient: "from-rose-400 via-amber-400 to-orange-500",
    emoji: "🏛️",
    excerpt:
      "Itinéraire complet jour par jour, budget détaillé, quartiers où dormir et checklist imprimable.",
  },
  {
    slug: "lisbonne-4-jours",
    destination: "Lisbonne",
    title: "Lisbonne en 4 jours",
    duration: "4 jours",
    budget: "≈ 550€",
    audience: "City-break ensoleillé",
    status: "coming-soon",
    price: "9€",
    gradient: "from-amber-300 via-yellow-400 to-lime-400",
    emoji: "🚋",
    excerpt: "Collines, tramways et belvédères : l'itinéraire arrive bientôt.",
  },
  {
    slug: "barcelone-3-jours",
    destination: "Barcelone",
    title: "Barcelone en 3 jours",
    duration: "3 jours",
    budget: "≈ 450€",
    audience: "Week-end prolongé",
    status: "coming-soon",
    price: "9€",
    gradient: "from-orange-400 via-red-400 to-rose-500",
    emoji: "🏖️",
    excerpt: "Gaudí, tapas et plage : le guide est en préparation.",
  },
  {
    slug: "londres-4-jours",
    destination: "Londres",
    title: "Londres en 4 jours",
    duration: "4 jours",
    budget: "≈ 800€",
    audience: "Première fois à Londres",
    status: "coming-soon",
    price: "9€",
    gradient: "from-slate-400 via-indigo-400 to-blue-500",
    emoji: "🎡",
    excerpt: "Musées gratuits, quartiers et bons plans : bientôt disponible.",
  },
  {
    slug: "tokyo-7-jours",
    destination: "Tokyo",
    title: "Tokyo en 7 jours",
    duration: "7 jours",
    budget: "≈ 1500€",
    audience: "Grand voyage organisé",
    status: "coming-soon",
    price: "12€",
    gradient: "from-pink-400 via-fuchsia-400 to-purple-500",
    emoji: "🗼",
    excerpt: "Transports, quartiers et culture : l'itinéraire arrive.",
  },
  {
    slug: "new-york-5-jours",
    destination: "New York",
    title: "New York en 5 jours",
    duration: "5 jours",
    budget: "≈ 1300€",
    audience: "Premier voyage aux USA",
    status: "coming-soon",
    price: "12€",
    gradient: "from-sky-400 via-cyan-400 to-teal-500",
    emoji: "🗽",
    excerpt: "Manhattan, Brooklyn et bons plans : en préparation.",
  },
];

/**
 * Fusionne les guides statiques avec les entrées de la content collection.
 * Les guides de la collection (non-draft) remplacent les statiques par slug
 * et passent automatiquement en status "available".
 */
export function mergeGuidesWithCollection(
  collectionEntries: Array<{
    id: string;
    data: {
      title: string;
      description: string;
      destination: string;
      duration: string;
      budget: string;
      price: string;
      emoji: string;
      gradient: string;
      draft: boolean;
    };
  }>
): Guide[] {
  const merged = new Map<string, Guide>();

  // D'abord les statiques
  for (const g of staticGuides) {
    merged.set(g.slug, g);
  }

  // Puis les entrées de la collection (écrasent si même slug)
  for (const entry of collectionEntries) {
    if (entry.data.draft) continue;
    const slug = entry.id;
    const existing = merged.get(slug);
    merged.set(slug, {
      slug,
      destination: entry.data.destination,
      title: entry.data.title,
      duration: entry.data.duration || existing?.duration || "",
      budget: entry.data.budget || existing?.budget || "",
      audience: existing?.audience || "Voyageurs curieux",
      status: "available",
      price: entry.data.price || existing?.price || "9€",
      gradient: entry.data.gradient || existing?.gradient || "from-brand-500 to-accent-600",
      emoji: entry.data.emoji || existing?.emoji || "📍",
      excerpt: entry.data.description || existing?.excerpt || "",
    });
  }

  // Trier : disponibles d'abord, puis par destination
  return Array.from(merged.values()).sort((a, b) => {
    if (a.status === "available" && b.status !== "available") return -1;
    if (a.status !== "available" && b.status === "available") return 1;
    return a.destination.localeCompare(b.destination);
  });
}

/** Raccourci rétro-compatible (utilisé dans les pages qui n'ont pas accès à getCollection) */
export const guides = staticGuides;

export const getGuide = (slug: string): Guide | undefined =>
  staticGuides.find((g) => g.slug === slug);

export const featuredGuide = staticGuides[0];
