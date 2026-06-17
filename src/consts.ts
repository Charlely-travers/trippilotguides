/**
 * Constantes globales du site.
 * 👉 Remplace ici les liens placeholders par tes vrais liens
 *    (Gumroad / Etsy / Payhip pour la vente, Tally / MailerLite pour les emails),
 *    ainsi que les informations légales marquées [À COMPLÉTER].
 */

export const SITE = {
  name: "TripPilot Guides",
  url: "https://trippilotguides.com",
  defaultTitle: "TripPilot Guides — Guides de voyage PDF prêts à suivre",
  defaultDescription:
    "Guides de voyage PDF complets : planning jour par jour, budget détaillé, quartiers où dormir, transports, checklist et conseils pratiques. Préparez votre voyage sans stress.",
  locale: "fr_FR",
  lang: "fr",
  /** Image Open Graph par défaut. */
  ogImage: "/logo.png",
} as const;

/** Liens externes — à remplacer par les vrais. */
export const LINKS = {
  // Achat du guide Rome — pointe vers la page guide pour l'instant
  buyRomeGuide: "/guides/rome-5-jours-budget-700",
  // Checklist gratuite — page interne
  freeChecklist: "/checklist-rome-gratuite",
  // Contact
  email: "hello@trippilotguides.com",
} as const;

/** Informations société / éditeur (pages légales). À compléter. */
export const COMPANY = {
  legalName: "[À COMPLÉTER — nom de l'éditeur / micro-entreprise]",
  status: "[À COMPLÉTER — ex. Micro-entrepreneur]",
  siret: "[À COMPLÉTER — n° SIRET]",
  address: "[À COMPLÉTER — adresse postale]",
  publicationManager: "[À COMPLÉTER — nom du directeur de la publication]",
  host: {
    name: "Vercel Inc.",
    address: "340 S Lemon Ave #4133, Walnut, CA 91789, USA",
  },
} as const;

/** Disclaimer affiché sur les pages produit / blog. */
export const DISCLAIMER =
  "Les prix et horaires peuvent évoluer. Vérifiez toujours les informations importantes avant votre départ.";

/** Date de dernière mise à jour des documents légaux (à actualiser au besoin). */
export const LEGAL_UPDATED = "16 juin 2026";
