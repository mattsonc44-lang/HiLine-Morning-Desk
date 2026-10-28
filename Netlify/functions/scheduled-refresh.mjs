// Weekday morning refresh at 14:50 UTC (8:50 AM MDT / 7:50 AM MST), after the grain markets open.
// Refreshes the home ZIP plus the ZIPs people opened in the last week, up to MAX_SCHEDULED_ZIPS.
import { startRefresh } from "../lib/start.mjs";
import { HOME_ZIP, listZipMeta } from "../lib/store.mjs";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default async (req, context) => {
  const origin = (context && context.site && context.site.url) || Netlify.env.get("URL");
  if (!origin) return;
  const max = Number(Netlify.env.get("MAX_SCHEDULED_ZIPS")) || 10;

  const recent = (await listZipMeta())
    .filter(({ zip, meta }) => zip !== HOME_ZIP && meta.lastViewed && Date.now() - Date.parse(meta.lastViewed) < WEEK_MS)
    .sort((a, b) => Date.parse(b.meta.lastViewed) - Date.parse(a.meta.lastViewed))
    .map(({ zip }) => zip);
  const zips = [HOME_ZIP, ...recent].slice(0, max);

  await Promise.allSettled(zips.map((zip) => startRefresh({ origin, zip, trigger: "scheduled" })));
};

export const config = { schedule: "50 14 * * 1-5" };
