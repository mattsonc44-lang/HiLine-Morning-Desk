// Stock and index quotes for the watchlist (Yahoo Finance chart data, delayed). Cached 5 minutes per symbol.
import { store } from "../lib/store.mjs";

const TTL_MS = 5 * 60 * 1000;
const MAX_SYMBOLS = 12;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export const cleanSymbol = (s) => {
  const t = String(s || "").trim().toUpperCase();
  return /^[\^A-Z0-9][A-Z0-9.\-=^]{0,14}$/.test(t) ? t : null;
};

async function fetchChart(sym) {
  let lastErr;
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=1mo&interval=1d`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 404) return { symbol: sym, error: "not found" };
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const j = await res.json();
      const r = j && j.chart && j.chart.result && j.chart.result[0];
      if (!r) return { symbol: sym, error: "not found" };
      const m = r.meta || {};
      const closes = ((r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || []).filter((v) => typeof v === "number");
      const price = typeof m.regularMarketPrice === "number" ? m.regularMarketPrice : closes[closes.length - 1];
      // Previous close: the last daily close before today's bar.
      const prev = closes.length >= 2 ? closes[closes.length - 2] : m.chartPreviousClose;
      const change = typeof price === "number" && typeof prev === "number" ? price - prev : null;
      return {
        symbol: sym,
        name: m.shortName || m.longName || sym,
        price,
        change,
        changePct: change != null && prev ? (change / prev) * 100 : null,
        currency: m.currency || "USD",
        time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
        spark: closes.slice(-22),
        fetchedAt: new Date().toISOString(),
      };
    } catch (e) {
      lastErr = String((e && e.message) || e).slice(0, 100);
    }
  }
  return { symbol: sym, error: lastErr || "unavailable", transient: true };
}

async function quote(sym) {
  const key = "quote/" + sym.replace(/[^A-Z0-9.\-=]/g, (c) => "_" + c.charCodeAt(0));
  let st = null;
  try { st = store(); } catch {} // a quote still works if the cache isn't reachable
  const cached = st ? await st.get(key, { type: "json" }).catch(() => null) : null;
  if (cached && cached.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS) return cached;
  const fresh = await fetchChart(sym);
  if (!fresh.error) { if (st) await st.setJSON(key, fresh).catch(() => {}); return fresh; }
  if (cached && fresh.transient) return { ...cached, stale: true };
  return fresh;
}

export default async (req) => {
  const raw = (new URL(req.url).searchParams.get("s") || "").split(",");
  const syms = [...new Set(raw.map(cleanSymbol).filter(Boolean))].slice(0, MAX_SYMBOLS);
  if (!syms.length) return json({ quotes: [] });
  const quotes = await Promise.all(syms.map(quote));
  return json({ quotes });
};

export const config = { path: "/api/quotes", method: "GET" };
