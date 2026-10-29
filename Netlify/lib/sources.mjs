// Fixed sources: national data every ZIP shares, plus the Chester elevators the home ZIP uses.
import { extractText, getDocumentProxy } from "unpdf";

export const NATIONAL_SOURCES = {
  agdirect: { url: "https://www.agdirect.com/rates", kind: "html", label: "AgDirect equipment loan rates page" },
  canola: { url: "https://www.ams.usda.gov/mnreports/ams_2887.pdf", kind: "pdf", label: "USDA National Daily Sunflower, Canola, Millet and Flaxseed Report" },
  pulses: { url: "https://www.ams.usda.gov/mnreports/AMS_2914.pdf", kind: "pdf", label: "USDA Weekly Bean, Pea and Lentil Market Review" },
  // Monthly NASS report; the file name changes each release, so it's found from the listing page.
  barley: { url: "https://esmis.nal.usda.gov/publication/agricultural-prices", kind: "nass", label: "USDA NASS Agricultural Prices (monthly), barley tables" },
  canada: { url: "https://mygrainexchange.com/en/prices", kind: "html", label: "My Grain Exchange Western Canada delivered prices (CAD)" },
};

export const CHESTER_SOURCES = {
  egt: { url: "https://www.bungeag.com/locations/chester-mt/", kind: "html", label: "EGT/Bunge Chester cash bids page" },
  columbia: { url: "https://columbiagrain.com/location/chester-mt/", kind: "html", label: "Columbia Grain Chester location page" },
  usda: { url: "https://www.ams.usda.gov/mnreports/ams_2771.pdf", kind: "pdf", label: "USDA Montana Daily Elevator Grain Bids" },
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const MAX_CHARS = 40000;

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/table)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#36;|&dollar;/g, "$")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// Finds the latest NASS Agricultural Prices text file and keeps just the barley tables.
async function fetchNassBarley(src) {
  const list = await fetch(src.url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!list.ok) throw new Error(`listing HTTP ${list.status}`);
  const html = await list.text();
  const m = html.match(/\/sites\/default\/release-files\/\d+\/agpr\d{4}\.txt/);
  if (!m) throw new Error("couldn't find the latest report file");
  const fileUrl = new URL(m[0], src.url).href;
  const res = await fetch(fileUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`report HTTP ${res.status}`);
  const txt = await res.text();
  // Keep the actual tables (they list states), not table-of-contents mentions.
  const parts = [];
  const re = /Prices Received for (All|Malting|Feed) Barley/g;
  let x;
  while ((x = re.exec(txt)) && parts.length < 3) {
    const win = txt.slice(x.index, x.index + 3500);
    if (/Montana/.test(win) && /United States/.test(win)) parts.push(win);
  }
  const head = txt.slice(0, 1500);
  return { text: `Report file: ${fileUrl}\n${head}\n...\n${parts.join("\n---\n")}`, fileUrl };
}

async function fetchOne(key, src) {
  try {
    if (src.kind === "nass") {
      const { text } = await fetchNassBarley(src);
      return { key, ok: text.length > 400, text: text.slice(0, MAX_CHARS), error: text.length > 400 ? null : "barley tables not found" };
    }
    const res = await fetch(src.url, {
      headers: { "User-Agent": UA, Accept: src.kind === "pdf" ? "application/pdf" : "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return { key, ok: false, error: `HTTP ${res.status}` };
    let text;
    if (src.kind === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
      const out = await extractText(pdf, { mergePages: true });
      text = Array.isArray(out.text) ? out.text.join("\n") : out.text;
    } else {
      text = htmlToText(await res.text());
    }
    text = (text || "").slice(0, MAX_CHARS);
    return { key, ok: text.length > 200, text, error: text.length > 200 ? null : "page came back nearly empty" };
  } catch (e) {
    return { key, ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

export async function fetchSources(srcMap) {
  const results = await Promise.all(Object.entries(srcMap).map(([k, s]) => fetchOne(k, s)));
  return Object.fromEntries(results.map((r) => [r.key, r]));
}

// Bank of Canada daily exchange rate: Canadian dollars per 1 US dollar.
export async function fetchUsdCad() {
  const res = await fetch("https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1", {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Bank of Canada HTTP ${res.status}`);
  const j = await res.json();
  const o = j && Array.isArray(j.observations) && j.observations[0];
  const v = o && o.FXUSDCAD && Number(o.FXUSDCAD.v);
  if (!v || !Number.isFinite(v) || v < 0.8 || v > 2.5) throw new Error("Bank of Canada rate missing");
  return { usdcad: v, date: o.d, source: "Bank of Canada", url: "https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/" };
}
