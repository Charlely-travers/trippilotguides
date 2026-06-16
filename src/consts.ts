/**
 * Constantes globales du site.
 * 👉 Remplace ici les liens placeholders par tes vrais liens
 *    (Gumroad / Etsy / Payhip pour la vente, Tally / MailerLite pour les emails).
 */

export const SITE = {
  name: "TripPilot Guides",
  url: "https://trippilotguides.com",
  defaultTitle: "TripPilot Guides — Guides de voyage PDF prêts à suivre",
  defaultDescription:
    "Guides de voyage PDF complets : planning jour par jour, budget détaillé, quartiers où dormir, transports, checklist et conseils pratiques. Préparez votre voyage sans stress.",
  locale: "fr_FR",
  lang: "fr",
} as const;

/** Liens externes — à remplacer par les vrais. */
export const LINKS = {
  // Achat du guide Rome (Gumroad / Etsy / Payhip)
  buyRomeGuide: "https://gumroad.com/l/rome-guide-placeholder",
  // Formulaire de capture d'email pour la checklist gratuite (Tally / MailerLite)
  freeChecklist: "https://tally.so/r/placeholder",
  // Réseaux (optionnels)
  email: "mailto:hello@trippilotguides.com",
} as const;

/** Disclaimer affiché sur les pages produit / blog. */
export const DISCLAIMER =
  "Les prix et horaires peuvent évoluer. Vérifiez toujours les informations importantes avant votre départ.";
