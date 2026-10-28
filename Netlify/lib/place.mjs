// Turns a ZIP code into a town, state and coordinates (zippopotam.us, free, no key).
import { getZipMeta, saveZipMeta } from "./store.mjs";

export const isZip = (z) => typeof z === "string" && /^\d{5}$/.test(z);

const VIEW_WRITE_EVERY_MS = 60 * 60 * 1000;

async function lookup(zip) {
  const res = await fetch(`https://api.zippopotam.us/us/${zip}`, { signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("ZIP lookup failed (HTTP " + res.status + ")");
  const j = await res.json();
  const p = j.places && j.places[0];
  if (!p) return null;
  return {
    city: p["place name"],
    state: p.state,
    st: p["state abbreviation"],
    lat: Number(p.latitude),
    lon: Number(p.longitude),
  };
}

// Returns the place for a ZIP (or null if the ZIP doesn't exist). Optionally records a page view,
// which is how the morning refresh knows which ZIPs people are using.
export async function placeFor(zip, { markViewed = false } = {}) {
  let meta = await getZipMeta(zip);
  if (!meta || !meta.place) {
    const place = await lookup(zip);
    if (!place) return null;
    meta = { place, lastViewed: markViewed ? new Date().toISOString() : null };
    await saveZipMeta(zip, meta);
    return meta.place;
  }
  if (markViewed && (!meta.lastViewed || Date.now() - Date.parse(meta.lastViewed) > VIEW_WRITE_EVERY_MS)) {
    await saveZipMeta(zip, { ...meta, lastViewed: new Date().toISOString() });
  }
  return meta.place;
}
