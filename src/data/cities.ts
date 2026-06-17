/**
 * Images et données visuelles des villes.
 * Utilise des images Unsplash CDN (gratuites, optimisées, pas besoin d'upload).
 * Format : https://images.unsplash.com/photo-ID?w=WIDTH&q=QUALITY&fit=crop
 */

export interface CityVisuals {
  /** Image héro large (1200px) */
  hero: string;
  /** Image carte (600px) */
  card: string;
  /** Crédit photo (attribution Unsplash) */
  credit: string;
}

const unsplash = (id: string, w = 1200, q = 80) =>
  `https://images.unsplash.com/${id}?w=${w}&q=${q}&fit=crop&auto=format`;

export const cityImages: Record<string, CityVisuals> = {
  rome: {
    hero: unsplash("photo-1552832230-c0197dd311b5"),
    card: unsplash("photo-1552832230-c0197dd311b5", 600),
    credit: "Photo by David Köhler on Unsplash",
  },
  lisbonne: {
    hero: unsplash("photo-1585208798174-6cedd86e019a"),
    card: unsplash("photo-1585208798174-6cedd86e019a", 600),
    credit: "Photo by Daniel Adventures on Unsplash",
  },
  barcelone: {
    hero: unsplash("photo-1583422409516-2895a77efed6"),
    card: unsplash("photo-1583422409516-2895a77efed6", 600),
    credit: "Photo by Aventures Espagne on Unsplash",
  },
  londres: {
    hero: unsplash("photo-1513635269975-59663e0ac1ad"),
    card: unsplash("photo-1513635269975-59663e0ac1ad", 600),
    credit: "Photo by Benjamin Davies on Unsplash",
  },
  tokyo: {
    hero: unsplash("photo-1540959733332-eab4deabeeaf"),
    card: unsplash("photo-1540959733332-eab4deabeeaf", 600),
    credit: "Photo by Jezael Melgoza on Unsplash",
  },
  "new-york": {
    hero: unsplash("photo-1496442226666-8d4d0e62e6e9"),
    card: unsplash("photo-1496442226666-8d4d0e62e6e9", 600),
    credit: "Photo by Roberto Vivancos on Unsplash",
  },
  porto: {
    hero: unsplash("photo-1555881400-74d7acaacd8b"),
    card: unsplash("photo-1555881400-74d7acaacd8b", 600),
    credit: "Photo by Nick Karvounis on Unsplash",
  },
  seville: {
    hero: unsplash("photo-1515443961218-a51367888e4b"),
    card: unsplash("photo-1515443961218-a51367888e4b", 600),
    credit: "Photo by Joan Oger on Unsplash",
  },
  cracovie: {
    hero: unsplash("photo-1519197924294-4ba991a11128"),
    card: unsplash("photo-1519197924294-4ba991a11128", 600),
    credit: "Photo by catwalk photos on Unsplash",
  },
  budapest: {
    hero: unsplash("photo-1549877452-9c387954fbc2"),
    card: unsplash("photo-1549877452-9c387954fbc2", 600),
    credit: "Photo by Keszthelyi Timi on Unsplash",
  },
};

/** Fallback image si ville pas dans le dictionnaire */
export const fallbackImage = unsplash("photo-1488646953014-85cb44e25828");

export function getCityImage(slug: string): CityVisuals {
  // Normalise le slug pour matcher les clés
  const key = slug
    .toLowerCase()
    .replace(/[^a-z-]/g, "")
    .replace(/-\d+.*$/, "") // "rome-5-jours-budget-700" -> "rome"
    .trim();
  return (
    cityImages[key] || {
      hero: fallbackImage,
      card: fallbackImage,
      credit: "Photo on Unsplash",
    }
  );
}
