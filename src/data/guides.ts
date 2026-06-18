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
  /** Image hero/card locale optionnelle (issue de la content collection) */
  image?: string;
  cardImage?: string;
}

/**
 * Guides "statiques" hérités. Désormais vide : le site est 100% piloté par la
 * content collection (src/content/guides/). Le pipeline productize y crée les guides.
 */
export const staticGuides: Guide[] = [];

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
      image?: string;
      cardImage?: string;
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
      image: entry.data.image || existing?.image,
      cardImage: entry.data.cardImage || existing?.cardImage,
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

/** Premier guide statique (peut être undefined si tout est piloté par la collection). */
export const featuredGuide: Guide | undefined = staticGuides[0];
