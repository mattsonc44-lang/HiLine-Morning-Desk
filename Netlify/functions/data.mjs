import { HOME_ZIP, getBriefing, getStatus, getNational } from "../lib/store.mjs";
import { isZip, placeFor } from "../lib/place.mjs";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  const zip = new URL(req.url).searchParams.get("zip") || HOME_ZIP;
  if (!isZip(zip)) return json({ error: "Enter a 5-digit ZIP code." }, 400);

  let place;
  try {
    place = await placeFor(zip, { markViewed: true });
  } catch {
    return json({ error: "Couldn't look up that ZIP code right now. Try again in a minute." }, 502);
  }
  if (!place) return json({ error: `ZIP code ${zip} wasn't found.` }, 404);

  const [briefing, status, national] = await Promise.all([getBriefing(zip), getStatus(zip), getNational()]);
  // National sections (AgDirect, canola, pulses) are shared, so show the freshest copy even before
  // this ZIP has had its own refresh.
  let b = briefing ? { ...briefing } : null;
  if (national) {
    b = b || { zip, place, empty: true };
    if (national.agdirect) b.agdirect = national.agdirect;
    b.specialty = { canola: national.canola || (b.specialty && b.specialty.canola), pulses: national.pulses || (b.specialty && b.specialty.pulses) };
  }
  const { token, ...publicStatus } = status || {};
  return json({ zip, place, isHome: zip === HOME_ZIP, briefing: b, status: publicStatus });
};

export const config = { path: "/api/data", method: "GET" };
