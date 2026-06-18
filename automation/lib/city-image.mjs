/**
 * Récupère une vraie photo d'une destination et la stocke localement dans
 * public/images/cities/. Objectif : images 100% fiables et spécifiques pour le
 * pipeline automatisé (jamais d'image cassée, jamais de drapeau/blason).
 *
 * Sources (dans l'ordre) :
 *   1. Openverse (agrégateur de photos Creative Commons) — vraies photos de ville
 *   2. Wikipedia REST summary — image principale (filtrée pour exclure drapeaux/cartes)
 *
 * Renvoie les chemins publics + l'attribution (licence CC).
 */

import fs from "node:fs/promises";
import path from "node:path";

const USER_AGENT =
  "TripPilotGuides/1.0 (https://trippilotguides.com; hello@trippilotguides.com)";

// Mots à exclure (drapeaux, blasons, cartes, logos, portraits…)
const REJECT_RE =
  /(flag|drapeau|bandera|coat[_\s-]?of[_\s-]?arms|escut|escudo|wappen|blason|\bmap\b|carte|locator|seal|logo|emblem|portrait|person|people|meeting|conference|ceremon|funeral|protest)/i;

function slugify(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Recherche une belle photo de la ville via Openverse. */
async function openverseImage(destination) {
  const queries = [
    `${destination} cityscape`,
    `${destination} city`,
    `${destination} skyline`,
    destination,
  ];
  for (const q of queries) {
    try {
      const url =
        "https://api.openverse.org/v1/images/?" +
        new URLSearchParams({
          q,
          page_size: "20",
          mature: "false",
        }).toString();
      const data = await fetchJson(url);
      const results = Array.isArray(data?.results) ? data.results : [];
      // Garde les photos paysage, assez grandes, sans contenu indésirable.
      const candidate = results.find((r) => {
        const w = Number(r.width || 0);
        const h = Number(r.height || 0);
        const title = `${r.title || ""} ${r.foreign_landing_url || ""}`;
        if (REJECT_RE.test(title)) return false;
        if (w && h && w / h < 1.2) return false; // veut du paysage
        if (w && w < 1000) return false;
        return Boolean(r.url);
      });
      if (candidate) {
        const creator = candidate.creator || "Auteur inconnu";
        const license = `${String(candidate.license || "").toUpperCase()} ${
          candidate.license_version || ""
        }`.trim();
        return {
          url: candidate.url,
          credit: `Photo : ${creator} (${license || "CC"}) via Openverse`,
        };
      }
    } catch {
      // requête suivante
    }
  }
  return null;
}

/** Repli : image principale Wikipedia (en excluant drapeaux/blasons/cartes). */
async function wikipediaImage(destination) {
  const langs = ["fr", "en"];
  const base = destination.charAt(0).toUpperCase() + destination.slice(1);
  const titles = [...new Set([base, destination])];
  for (const lang of langs) {
    for (const title of titles) {
      try {
        const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          title
        )}`;
        const data = await fetchJson(url);
        if (data?.type === "disambiguation") continue;
        const img = data?.originalimage?.source || data?.thumbnail?.source || "";
        if (img && !REJECT_RE.test(img) && !/\.svg(\?|$)/i.test(img)) {
          return { url: img, credit: `Photo via Wikipedia (${lang})` };
        }
      } catch {
        /* suivant */
      }
    }
  }
  return null;
}

async function downloadBuffer(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Récupère les coordonnées (lat/lon) du centre-ville via Wikipedia, repli Nominatim. */
async function cityCoordinates(destination) {
  const base = destination.charAt(0).toUpperCase() + destination.slice(1);
  for (const lang of ["fr", "en"]) {
    for (const title of [...new Set([base, destination])]) {
      try {
        const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          title
        )}`;
        const data = await fetchJson(url);
        if (data?.coordinates?.lat && data?.coordinates?.lon) {
          return { lat: data.coordinates.lat, lon: data.coordinates.lon };
        }
      } catch {
        /* suivant */
      }
    }
  }
  // Repli : géocodage Nominatim (OSM), sans clé.
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({ q: destination, format: "json", limit: "1" }).toString();
    const arr = await fetchJson(url);
    if (Array.isArray(arr) && arr[0]?.lat && arr[0]?.lon) {
      return { lat: Number(arr[0].lat), lon: Number(arr[0].lon) };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Conversion lon/lat -> coordonnées de tuile (fractionnaires) au zoom donné. */
function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y, n };
}

/**
 * Génère une carte statique de la ville en assemblant des tuiles OpenStreetMap
 * (tile.openstreetmap.org, fiable, sans clé). Stocke un WebP local.
 * @returns {Promise<{ok:boolean, map?:string, reason?:string, coords?:object}>}
 */
export async function fetchCityMap({ destination, slug, publicDir, zoom = 13 }) {
  const citySlug = slugify(slug || destination);
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return { ok: false, reason: "sharp_unavailable" };
  }

  const coords = await cityCoordinates(destination);
  if (!coords) return { ok: false, reason: "no_coordinates" };

  const TILE = 256;
  const COLS = 4; // largeur : 4 tuiles = 1024 px
  const ROWS = 3; // hauteur : 3 tuiles = 768 px
  const { x: xf, y: yf } = lonLatToTile(coords.lon, coords.lat, zoom);
  const xtile = Math.floor(xf);
  const ytile = Math.floor(yf);
  const startX = xtile - 1; // 1 tuile à gauche
  const startY = ytile - 1; // 1 tuile en haut

  // Télécharge la grille de tuiles.
  const composites = [];
  try {
    for (let dy = 0; dy < ROWS; dy++) {
      for (let dx = 0; dx < COLS; dx++) {
        const tx = startX + dx;
        const ty = startY + dy;
        const url = `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`;
        const buf = await downloadBuffer(url);
        composites.push({ input: buf, left: dx * TILE, top: dy * TILE });
      }
    }
  } catch (err) {
    return { ok: false, reason: `tiles_failed: ${err.message}` };
  }

  const outDir = path.join(publicDir, "images", "cities");
  await fs.mkdir(outDir, { recursive: true });
  const mapRel = `/images/cities/${citySlug}-map.webp`;
  const mapPath = path.join(outDir, `${citySlug}-map.webp`);

  try {
    // Assemble la grille complète.
    const full = await sharp({
      create: {
        width: COLS * TILE,
        height: ROWS * TILE,
        channels: 3,
        background: { r: 233, g: 231, b: 226 },
      },
    })
      .composite(composites)
      .png()
      .toBuffer();

    // Recadre une fenêtre 900x520 centrée sur la ville.
    const centerX = (xf - startX) * TILE;
    const centerY = (yf - startY) * TILE;
    const cropW = 900;
    const cropH = 520;
    const left = Math.max(0, Math.min(COLS * TILE - cropW, Math.round(centerX - cropW / 2)));
    const top = Math.max(0, Math.min(ROWS * TILE - cropH, Math.round(centerY - cropH / 2)));

    await sharp(full)
      .extract({ left, top, width: cropW, height: cropH })
      .webp({ quality: 88 })
      .toFile(mapPath);
  } catch (err) {
    return { ok: false, reason: `map_compose_failed: ${err.message}` };
  }

  return { ok: true, map: mapRel, coords };
}

/** Nettoie un nom de lieu pour la recherche/légende (retire parenthèses, mentions de prix…). */
function cleanPlaceName(name) {
  return String(name || "")
    .replace(/\([^)]*\)/g, "") // retire le contenu entre parenthèses
    .replace(/\s*[-–—:].*$/, "") // coupe après tiret/deux-points (sous-titres)
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Recherche une photo précise d'un lieu (monument, site) via Openverse. */
async function openversePlacePhoto(query) {
  try {
    const url =
      "https://api.openverse.org/v1/images/?" +
      new URLSearchParams({ q: query, page_size: "30", mature: "false" }).toString();
    const data = await fetchJson(url);
    const results = Array.isArray(data?.results) ? data.results : [];
    const candidate = results.find((r) => {
      const w = Number(r.width || 0);
      const h = Number(r.height || 0);
      const title = `${r.title || ""} ${r.foreign_landing_url || ""}`;
      if (REJECT_RE.test(title)) return false;
      if (w && h && w / h < 1.1) return false; // évite les portraits
      if (w && w < 700) return false;
      return Boolean(r.url);
    });
    if (!candidate) return null;
    const creator = candidate.creator || "Auteur inconnu";
    const license = `${String(candidate.license || "").toUpperCase()} ${
      candidate.license_version || ""
    }`.trim();
    return {
      url: candidate.url,
      credit: `${creator} (${license || "CC"}) / Openverse`,
    };
  } catch {
    return null;
  }
}

/** Décode les entités HTML basiques d'un champ de métadonnées Commons. */
function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Récupère auteur + licence d'un fichier Wikimedia Commons (best effort). */
async function commonsCredit(fileTitle) {
  if (!fileTitle) return "via Wikimedia Commons";
  try {
    const url =
      "https://commons.wikimedia.org/w/api.php?" +
      new URLSearchParams({
        action: "query",
        titles: fileTitle.startsWith("File:") ? fileTitle : `File:${fileTitle}`,
        prop: "imageinfo",
        iiprop: "extmetadata",
        format: "json",
        origin: "*",
      }).toString();
    const data = await fetchJson(url);
    const pages = data?.query?.pages || {};
    const page = Object.values(pages)[0];
    const meta = page?.imageinfo?.[0]?.extmetadata || {};
    const artist = stripHtml(meta.Artist?.value);
    const license = stripHtml(meta.LicenseShortName?.value);
    const parts = [];
    if (artist) parts.push(artist.slice(0, 60));
    if (license) parts.push(license);
    const credit = parts.join(" · ");
    return credit ? `${credit} / Wikimedia Commons` : "via Wikimedia Commons";
  } catch {
    return "via Wikimedia Commons";
  }
}

/**
 * Recherche une photo précise d'un lieu via Wikipédia (fr puis en).
 * Source FIABLE et sans clé — renvoie l'image principale de l'article + attribution.
 */
async function wikiPlacePhoto(query) {
  for (const lang of ["fr", "en"]) {
    try {
      const url =
        `https://${lang}.wikipedia.org/w/api.php?` +
        new URLSearchParams({
          action: "query",
          prop: "pageimages",
          piprop: "original",
          generator: "search",
          gsrsearch: query,
          gsrlimit: "3",
          gsrnamespace: "0",
          redirects: "1",
          format: "json",
          origin: "*",
        }).toString();
      const data = await fetchJson(url);
      const pages = Object.values(data?.query?.pages || {});
      // Préfère un résultat avec image, en filtrant drapeaux/cartes/svg.
      const withImg = pages
        .filter((p) => p?.original?.source)
        .filter((p) => {
          const src = p.original.source;
          return !REJECT_RE.test(src) && !/\.svg(\?|$)/i.test(src);
        })
        .sort((a, b) => (a.index || 99) - (b.index || 99));
      const hit = withImg[0];
      if (!hit) continue;
      const src = hit.original.source;
      // Devine le titre de fichier depuis l'URL pour l'attribution.
      const fileName = decodeURIComponent(src.split("/").pop().split("?")[0] || "");
      const credit = await commonsCredit(fileName);
      return { url: src, credit };
    } catch {
      /* langue suivante */
    }
  }
  return null;
}

/**
 * Récupère de vraies photos des principaux sites/monuments d'une destination et
 * les stocke en local (800x500 webp). Utilisé pour illustrer le guide PDF.
 * @param {{places:string[], destination:string, slug:string, publicDir:string, max?:number}} args
 * @returns {Promise<Array<{name:string, path:string, credit:string}>>}
 */
export async function fetchPlacePhotos({ places, destination, slug, publicDir, max = 4 }) {
  const citySlug = slugify(slug || destination);
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return [];
  }

  const outDir = path.join(publicDir, "images", "cities");
  await fs.mkdir(outDir, { recursive: true });

  const out = [];
  const seenUrls = new Set();
  let index = 0;

  for (const raw of places || []) {
    if (out.length >= max) break;
    const clean = cleanPlaceName(raw);
    if (!clean) continue;

    // Plusieurs requêtes du plus précis au plus général.
    const queries = [`${clean} ${destination}`, `${clean}`];
    let found = null;
    for (const q of queries) {
      // Wikipédia en priorité (fiable), Openverse en repli.
      found = (await wikiPlacePhoto(q)) || (await openversePlacePhoto(q));
      if (found && !seenUrls.has(found.url)) break;
      found = null;
    }
    if (process.env.DEBUG_PLACES) console.error("  place:", clean, "->", found ? found.url : "NONE");
    if (!found) continue;
    seenUrls.add(found.url);

    let buf;
    try {
      buf = await downloadBuffer(found.url);
    } catch (err) {
      if (process.env.DEBUG_PLACES) console.error("  download fail", clean, err.message);
      continue;
    }

    index += 1;
    const rel = `/images/cities/${citySlug}-place-${index}.webp`;
    const filePath = path.join(outDir, `${citySlug}-place-${index}.webp`);
    const pinRel = `/images/cities/${citySlug}-place-${index}-pin.webp`;
    const pinPath = path.join(outDir, `${citySlug}-place-${index}-pin.webp`);
    try {
      // Version galerie (paysage) pour le PDF.
      await sharp(buf)
        .resize(800, 500, { fit: "cover", position: "attention" })
        .webp({ quality: 80 })
        .toFile(filePath);
      // Version portrait haute résolution pour les épingles Pinterest (depuis l'original).
      await sharp(buf)
        .resize(1000, 1500, { fit: "cover", position: "attention" })
        .webp({ quality: 82 })
        .toFile(pinPath);
    } catch (err) {
      if (process.env.DEBUG_PLACES) console.error("  sharp fail", clean, err.message);
      index -= 1;
      continue;
    }

    out.push({ name: clean, path: rel, pinPath: pinRel, credit: found.credit });
  }

  return out;
}

/**
 * Récupère et stocke l'image d'une destination en hero (1600x900) et card (800x600).
 * @returns {Promise<{ok:boolean, hero?:string, card?:string, credit?:string, buffer?:Buffer, reason?:string}>}
 */
export async function fetchCityImage({ destination, slug, publicDir }) {
  const citySlug = slugify(slug || destination);
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return { ok: false, reason: "sharp_unavailable" };
  }

  const found = (await openverseImage(destination)) || (await wikipediaImage(destination));
  if (!found) return { ok: false, reason: "no_image_found" };

  let raw;
  try {
    raw = await downloadBuffer(found.url);
  } catch (err) {
    // Si la 1re source échoue au download, tente l'autre.
    const alt = await wikipediaImage(destination);
    if (alt && alt.url !== found.url) {
      try {
        raw = await downloadBuffer(alt.url);
        found.credit = alt.credit;
      } catch {
        return { ok: false, reason: `download_failed: ${err.message}` };
      }
    } else {
      return { ok: false, reason: `download_failed: ${err.message}` };
    }
  }

  const outDir = path.join(publicDir, "images", "cities");
  await fs.mkdir(outDir, { recursive: true });

  const heroRel = `/images/cities/${citySlug}-hero.webp`;
  const cardRel = `/images/cities/${citySlug}-card.webp`;
  const heroPath = path.join(outDir, `${citySlug}-hero.webp`);
  const cardPath = path.join(outDir, `${citySlug}-card.webp`);

  try {
    await sharp(raw)
      .resize(1600, 900, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toFile(heroPath);
    await sharp(raw)
      .resize(800, 600, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toFile(cardPath);
  } catch (err) {
    return { ok: false, reason: `resize_failed: ${err.message}` };
  }

  return {
    ok: true,
    hero: heroRel,
    card: cardRel,
    credit: found.credit,
    buffer: raw,
    sourceUrl: found.url,
  };
}
