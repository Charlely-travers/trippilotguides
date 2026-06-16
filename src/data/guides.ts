/** Données locales des guides de voyage. */

export type GuideStatus = "available" | "coming-soon";

export interface Guide {
  /** Identifiant utilisé dans l'URL (/guides/<slug>). */
  slug: string;
  destination: string;
  /** Titre marketing complet. */
  title: string;
  duration: string;
  /** Budget indicatif affiché sur la carte. */
  budget: string;
  /** Public cible. */
  audience: string;
  status: GuideStatus;
  /** Prix affiché (placeholder). */
  price: string;
  /** Couleur de dégradé pour le visuel (clé Tailwind/CSS). */
  gradient: string;
  /** Emoji/illustration de secours quand pas d'image. */
  emoji: string;
  /** Courte accroche. */
  excerpt: string;
}

export const guides: Guide[] = [
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

export const getGuide = (slug: string): Guide | undefined =>
  guides.find((g) => g.slug === slug);

export const featuredGuide = guides[0];
