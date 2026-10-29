// Netlify Blobs storage. Keys:
//   briefing/<zip>  the page data for one ZIP
//   status/<zip>    refresh state for one ZIP
//   zip/<zip>       place lookup + when someone last viewed it
//   national        AgDirect, canola and pulse data shared by every ZIP
//   usage           refresh count for today (cost cap)
import { getStore } from "@netlify/blobs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const HOME_ZIP = "59522";

export function store() {
  return getStore({ name: "hiline-desk", consistency: "strong" });
}

const getJSON = (key) => store().get(key, { type: "json" });
const setJSON = (key, v) => store().setJSON(key, v);

export async function getBriefing(zip) {
  const b = await getJSON("briefing/" + zip);
  if (b) return b;
  if (zip === HOME_ZIP) return loadSeed();
  return null;
}
export const saveBriefing = (zip, b) => setJSON("briefing/" + zip, b);

export async function getStatus(zip) {
  return (await getJSON("status/" + zip)) || { state: "idle" };
}
export const saveStatus = (zip, s) => setJSON("status/" + zip, s);

export const getZipMeta = (zip) => getJSON("zip/" + zip);
export const saveZipMeta = (zip, m) => setJSON("zip/" + zip, m);

export async function listZipMeta() {
  const { blobs } = await store().list({ prefix: "zip/" });
  const metas = await Promise.all(blobs.map(async (b) => ({ zip: b.key.slice(4), meta: await getJSON(b.key) })));
  return metas.filter((m) => m.meta);
}

export async function getNational() {
  const n = await getJSON("national");
  if (n) return n;
  const seed = await loadSeed();
  if (!seed) return null;
  const sp = seed.specialty || {};
  return { updatedAt: null, agdirect: seed.agdirect, canola: sp.canola, pulses: sp.pulses, barley: sp.barley, canada: sp.canada, fx: sp.fx };
}
export const saveNational = (n) => setJSON("national", n);

export async function getUsage() {
  return (await getJSON("usage")) || {};
}
export const saveUsage = (u) => setJSON("usage", u);

// Shown for the home ZIP until the first refresh runs.
async function loadSeed() {
  const candidates = [
    path.resolve(process.cwd(), "seed/briefing.json"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../seed/briefing.json"),
  ];
  for (const p of candidates) {
    try {
      const d = JSON.parse(await readFile(p, "utf8"));
      d.isSeed = true;
      return d;
    } catch {}
  }
  return null;
}
