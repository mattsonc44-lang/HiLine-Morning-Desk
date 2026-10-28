import { startRefresh } from "../lib/start.mjs";
import { HOME_ZIP } from "../lib/store.mjs";
import { isZip, placeFor } from "../lib/place.mjs";

const json = (body, status) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  const body = await req.json().catch(() => ({}));
  const zip = body.zip || HOME_ZIP;
  if (!isZip(zip)) return json({ message: "Enter a 5-digit ZIP code." }, 400);
  const place = await placeFor(zip).catch(() => undefined);
  if (place === undefined) return json({ message: "Couldn't look up that ZIP code right now. Try again in a minute." }, 502);
  if (!place) return json({ message: `ZIP code ${zip} wasn't found.` }, 404);

  const r = await startRefresh({ origin: new URL(req.url).origin, zip, trigger: body.first ? "first-look" : "manual" });
  return json({ message: r.message }, r.code);
};

export const config = { path: "/api/refresh", method: "POST" };
