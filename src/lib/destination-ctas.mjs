function clean(value) {
  return String(value || "").trim();
}

function inferDestination(postId, postData) {
  if (postData?.destination) return clean(postData.destination);
  const title = clean(postData?.title);
  if (/rome/i.test(`${postId} ${title}`)) return "Rome";
  const first = title.split(/\s+(?:en|:|-|—)/)[0]?.trim();
  return first || "votre destination";
}

function inferGuideSlug(postId, postData) {
  if (postData?.guideSlug) return clean(postData.guideSlug);
  if (/rome/i.test(`${postId} ${postData?.title || ""}`)) return "rome-5-jours-budget-700";
  return "";
}

function findBySlug(items, slug) {
  return (items || []).find((item) => item.slug === slug);
}

export function resolveBlogCtas({
  postId,
  postData,
  publishedGuides = [],
  publishedChecklists = [],
  legacyGuides = [],
  legacyChecklistHref = "/checklist-rome-gratuite",
}) {
  const destination = inferDestination(postId, postData);
  const guideSlug = inferGuideSlug(postId, postData);
  const checklistSlug = clean(postData?.checklistSlug);

  const publishedGuide = guideSlug ? findBySlug(publishedGuides, guideSlug) : null;
  const legacyGuide = guideSlug ? findBySlug(legacyGuides, guideSlug) : null;
  const guide = publishedGuide || legacyGuide || null;
  const publishedChecklist = checklistSlug
    ? findBySlug(publishedChecklists, checklistSlug)
    : null;
  const isRomeLegacy = guideSlug === "rome-5-jours-budget-700";

  const top = publishedChecklist
    ? {
        label: `Télécharger la checklist ${destination}`,
        href: `/checklists/${publishedChecklist.slug}`,
        external: false,
      }
    : isRomeLegacy
      ? {
          label: "Télécharger la checklist",
          href: legacyChecklistHref,
          external: false,
        }
      : {
          label: "Voir les guides disponibles",
          href: "/guides",
          external: false,
        };

  const guideCta = guide
    ? {
        available: true,
        title: guide.title,
        price: guide.price || "9€",
        href: `/guides/${guide.slug}`,
        label: "Voir le guide",
      }
    : {
        available: false,
        title: `Guide ${destination} en préparation`,
        price: "",
        href: "/guides",
        label: "Voir les guides disponibles",
      };

  return {
    destination,
    top,
    guide: guideCta,
  };
}

