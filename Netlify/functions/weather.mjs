// Weather for a ZIP from the National Weather Service (free, no key). Cached 30 minutes per ZIP.
import { HOME_ZIP, store } from "../lib/store.mjs";
import { isZip, placeFor } from "../lib/place.mjs";

const TTL_MS = 30 * 60 * 1000;
const UA = "HiLineMorningDesk/1.0 (hilinemorningdesk.netlify.app)";
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function nws(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/geo+json" }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`NWS HTTP ${res.status}`);
  return res.json();
}

const pct = (p) => (p && typeof p.value === "number" ? p.value : null);

// Pairs day and night periods into one entry per day.
function toDays(periods) {
  const days = [];
  for (const p of periods) {
    const date = p.startTime.slice(0, 10);
    let d = days.find((x) => x.date === date);
    if (!d) { d = { date, name: null, high: null, low: null, short: null, precip: null, wind: null, nightShort: null }; days.push(d); }
    if (p.isDaytime) {
      d.name = p.name; d.high = p.temperature; d.short = p.shortForecast;
      d.wind = `${p.windDirection} ${p.windSpeed}`.trim();
    } else {
      d.low = p.temperature; d.nightShort = p.shortForecast;
      if (!d.name) d.name = p.name;
    }
    const pp = pct(p.probabilityOfPrecipitation);
    if (pp != null) d.precip = Math.max(d.precip || 0, pp);
  }
  return days.slice(0, 7);
}

export async function build(place) {
  const pt = await nws(`https://api.weather.gov/points/${place.lat.toFixed(4)},${place.lon.toFixed(4)}`);
  const p = pt.properties;
  const [fc, hr] = await Promise.all([nws(p.forecast), nws(p.forecastHourly)]);
  const periods = fc.properties.periods || [];
  const hours = hr.properties.periods || [];
  const h0 = hours[0] || {};
  const today = periods[0] || {};
  return {
    fetchedAt: new Date().toISOString(),
    place: `${place.city}, ${place.st}`,
    now: {
      temp: h0.temperature,
      short: h0.shortForecast,
      wind: `${h0.windDirection || ""} ${h0.windSpeed || ""}`.trim(),
      precip: pct(h0.probabilityOfPrecipitation),
      isDaytime: h0.isDaytime !== false,
    },
    today: { name: today.name, detail: today.detailedForecast },
    // Next 12 hours of wind, for spraying and hauling.
    hourly: hours.slice(0, 12).map((h) => ({ time: h.startTime, temp: h.temperature, wind: h.windSpeed, dir: h.windDirection, precip: pct(h.probabilityOfPrecipitation), short: h.shortForecast })),
    days: toDays(periods),
    url: `https://forecast.weather.gov/MapClick.php?lat=${place.lat}&lon=${place.lon}`,
  };
}

export default async (req) => {
  const zip = new URL(req.url).searchParams.get("zip") || HOME_ZIP;
  if (!isZip(zip)) return json({ error: "Enter a 5-digit ZIP code." }, 400);
  let place;
  try { place = await placeFor(zip); } catch { return json({ error: "Couldn't look up that ZIP code." }, 502); }
  if (!place) return json({ error: `ZIP code ${zip} wasn't found.` }, 404);

  const key = "weather/" + zip;
  const cached = await store().get(key, { type: "json" }).catch(() => null);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS) return json(cached);
  try {
    const w = await build(place);
    await store().setJSON(key, w).catch(() => {});
    return json(w);
  } catch (e) {
    if (cached) return json({ ...cached, stale: true });
    return json({ error: "The National Weather Service didn't answer. Try again in a few minutes." }, 502);
  }
};

export const config = { path: "/api/weather", method: "GET" };
