// Fixed sources: national data every ZIP shares, plus the Chester elevators the home ZIP uses.
import { extractText, getDocumentProxy } from "unpdf";

export const NATIONAL_SOURCES = {
  agdirect: { url: "https://www.agdirect.com/rates", kind: "html", label: "AgDirect equipment loan rates page" },
  canola: { url: "https://www.ams.usda.gov/mnreports/ams_2887.pdf", kind: "pdf", label: "USDA National Daily Sunflower, Canola, Millet and Flaxseed Report" },
  pulses: { url: "https://www.ams.usda.gov/mnreports/AMS_2914.pdf", kind: "pdf", label: "USDA Weekly Bean, Pea and Lentil Market Review" },
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

async function fetchOne(key, src) {
  try {
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
