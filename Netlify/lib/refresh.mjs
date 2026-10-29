// One refresh for one ZIP: national data (shared, refreshed at most every 6 hours), local bids, news.
import { fetchSources, fetchUsdCad, NATIONAL_SOURCES, CHESTER_SOURCES } from "./sources.mjs";
import { extractFixed, researchLocal, researchNews } from "./claude.mjs";
import { HOME_ZIP, getBriefing, saveBriefing, getStatus, saveStatus, getNational, saveNational } from "./store.mjs";
import { placeFor } from "./place.mjs";

const NATIONAL_MAX_AGE_MS = 6 * 60 * 60 * 1000;

// Things that don't change day to day live here rather than in Claude's output.
const STATIC = {
  egt: { name: "EGT / Bunge — Chester", location: "3301 Laird Rd, Chester", url: "https://www.bungeag.com/locations/chester-mt/#cashbids" },
  columbia: { name: "Columbia Grain — Chester", location: "891 US Hwy 2, Chester", url: "https://columbiagrain.com/location/chester-mt/" },
  columbiaCard: { name: "Columbia Grain — Chester", location: "891 US Hwy 2, Chester", note: "Bids load inside their site and through the Bushel app, so they can't be pulled here yet.", url: "https://columbiagrain.com/location/chester-mt/", urlLabel: "Chester bids page ↗" },
  stricksCard: { name: "Stricks Ag — Chester", location: "114 E Washington Ave, Chester", note: "Buys chickpeas, lentils, peas and wheat. No bids posted online; call the elevator office.", phone: "406-759-6489", url: "https://stricksag.com/contact-us/", urlLabel: "Contact page ↗" },
  usda: { title: "Montana regional ranges", url: CHESTER_SOURCES.usda.url, note: "Delivered-to-truck ranges. The report has no Hi-Line region; North Central and Golden Triangle are closest." },
  agdirect: { url: "https://www.agdirect.com/rates", note: "Variable is Prime ± spread; not available on leases. Subject to credit approval; 0–45 day fixed-rate lock with no fee." },
  canola: { url: NATIONAL_SOURCES.canola.url, note: "Delivered by truck to crushers. Chg is the day's move on the current bid. Divide by 2 for $/bu (50 lb bu)." },
  pulses: { url: NATIONAL_SOURCES.pulses.url, note: "Conventional, delivered to warehouse. Min-Dak covers North Dakota and Montana buyers. Multiply peas by 0.6 for $/bu. Call a local pulse buyer for your own bid." },
  barley: { note: "Monthly average price farmers received, from USDA NASS. It runs about a month behind." },
  canada: { url: NATIONAL_SOURCES.canada.url, note: "Western Canada delivered prices in Canadian dollars, from My Grain Exchange. A reference for crops with no U.S. public bid, like mustard and flax." },
};

const FUT_LABELS = { MW: "MGEX Spring Wheat", KE: "KC HRW Wheat", KW: "KC HRW Wheat", ZW: "CBOT Wheat", ZC: "Corn", ZS: "Soybeans", RS: "ICE Canola", ZM: "Soy Meal", ZL: "Soy Oil", ZO: "Oats" };
const MONTHS = { F: "Jan", G: "Feb", H: "Mar", J: "Apr", K: "May", M: "Jun", N: "Jul", Q: "Aug", U: "Sep", V: "Oct", X: "Nov", Z: "Dec" };

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const mtDay = () => new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" }).format(new Date());

function validClasses(loc) {
  return loc && Array.isArray(loc.classes) && loc.classes.some((c) => Array.isArray(c.rows) && c.rows.some((r) => isNum(r.cash)));
}

function addChanges(loc, prevLoc) {
  const prev = {};
  ((prevLoc && prevLoc.classes) || []).forEach((c) => (c.rows || []).forEach((r) => { prev[c.name + "|" + r.month] = r.cash; }));
  loc.classes.forEach((c) => (c.rows || []).forEach((r) => {
    const p = prev[c.name + "|" + r.month];
    if (isNum(p) && isNum(r.cash)) {
      const d = Math.round((r.cash - p) * 10000) / 10000;
      if (d !== 0) r.chg = d; else delete r.chg;
    } else delete r.chg;
  }));
  return loc;
}

// Futures strip: every contract seen on the posted bid boards, first price wins.
function futuresFrom(posted) {
  const seen = new Map();
  posted.forEach((loc) => (loc.classes || []).forEach((c) => (c.rows || []).forEach((r) => {
    const sym = typeof r.symbol === "string" ? r.symbol.replace(/^@/, "").toUpperCase() : "";
    if (/^[A-Z]{2}[FGHJKMNQUVXZ]\d{1,2}$/.test(sym) && isNum(r.futures) && !seen.has(sym)) seen.set(sym, r.futures);
  })));
  return [...seen.entries()].slice(0, 6).map(([sym, price]) => {
    const root = sym.slice(0, 2), mon = MONTHS[sym[2]];
    return { label: `${FUT_LABELS[root] || root} ${mon || ""}`.trim(), symbol: sym, price };
  });
}

function validNews(arr) {
  return Array.isArray(arr) && arr.filter((n) => n && n.title && /^https?:\/\//.test(n.url || "")).length >= 2;
}

const errText = (e) => String((e && e.message) || e).slice(0, 200);

async function refreshNational({ apiKey, problems }) {
  const current = await getNational();
  // Retry sooner than 6 hours if the last national refresh had gaps.
  const complete = current && current.barley && current.canada && current.fx && !current.gaps;
  if (complete && current.updatedAt && Date.now() - Date.parse(current.updatedAt) < NATIONAL_MAX_AGE_MS) return current;
  const [sources, fx] = await Promise.all([
    fetchSources(NATIONAL_SOURCES),
    fetchUsdCad().catch((e) => { problems.push("Exchange rate: " + errText(e)); return null; }),
  ]);
  const before = problems.length;
  const next = { ...(current || {}) };
  if (fx) next.fx = fx;
  try {
    const { data: m = {} } = await extractFixed({ apiKey, sources, srcMeta: NATIONAL_SOURCES });
    if (m.agdirect && Array.isArray(m.agdirect.tiers) && m.agdirect.tiers.length) next.agdirect = { ...STATIC.agdirect, asOf: m.agdirect.asOf, terms: m.agdirect.terms, tiers: m.agdirect.tiers };
    else problems.push("AgDirect rates: " + (sources.agdirect.ok ? "couldn't read them" : sources.agdirect.error));
    if (m.canola && Array.isArray(m.canola.rows) && m.canola.rows.length) next.canola = { ...STATIC.canola, asOf: m.canola.asOf, cols: m.canola.cols, rows: m.canola.rows };
    else problems.push("Canola report: " + (sources.canola.ok ? "couldn't read it" : sources.canola.error));
    if (m.pulses && Array.isArray(m.pulses.rows) && m.pulses.rows.length) next.pulses = { ...STATIC.pulses, asOf: m.pulses.asOf, rows: m.pulses.rows };
    else problems.push("Pulse report: " + (sources.pulses.ok ? "couldn't read it" : sources.pulses.error));
    if (m.barley && m.barley.malting && Object.keys(m.barley.malting).length) next.barley = { ...STATIC.barley, ...m.barley };
    else problems.push("NASS barley prices: " + (sources.barley.ok ? "couldn't read them" : sources.barley.error));
    const canRows = m.canada && Array.isArray(m.canada.rows) ? m.canada.rows.filter((r) => r && r.crop && isNum(r.price)) : [];
    if (canRows.length >= 3) next.canada = { ...STATIC.canada, asOf: new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" }).format(new Date()), rows: canRows };
    else problems.push("Canadian prices: " + (sources.canada.ok ? "couldn't read them" : sources.canada.error));
  } catch (e) {
    problems.push("AgDirect, canola and pulse data: " + errText(e));
    return current;
  }
  next.updatedAt = new Date().toISOString();
  next.gaps = problems.length - before;
  await saveNational(next);
  return next;
}

// The home ZIP reads the Chester elevator pages directly.
async function localChester({ apiKey, prev, problems }) {
  const sources = await fetchSources(CHESTER_SOURCES);
  const prevPosted = (prev.bids && prev.bids.posted) || [];
  const prevByName = (n) => prevPosted.find((p) => p.name === n);
  let m = {};
  try {
    m = (await extractFixed({ apiKey, sources, srcMeta: CHESTER_SOURCES })).data || {};
  } catch (e) {
    problems.push("Chester bids: " + errText(e));
    return { bids: prev.bids, usda: prev.usda };
  }
  const posted = [];
  if (validClasses(m.egt)) posted.push(addChanges({ ...STATIC.egt, asOf: m.egt.asOf, classes: m.egt.classes }, prevByName(STATIC.egt.name)));
  else {
    const keep = prevByName(STATIC.egt.name);
    if (keep) posted.push(keep);
    problems.push("EGT/Bunge bids: " + (sources.egt.ok ? "no bids found on the page" : sources.egt.error));
  }
  const hasColumbia = validClasses(m.columbia);
  if (hasColumbia) posted.push(addChanges({ ...STATIC.columbia, asOf: m.columbia.asOf, classes: m.columbia.classes }, prevByName(STATIC.columbia.name)));
  const bids = { asOf: mtDay(), posted, callFor: hasColumbia ? [STATIC.stricksCard] : [STATIC.columbiaCard, STATIC.stricksCard] };
  let usda = prev.usda;
  if (m.usda && Array.isArray(m.usda.rows) && m.usda.rows.length) usda = { ...STATIC.usda, asOf: m.usda.asOf, rows: m.usda.rows };
  else problems.push("USDA Montana report: " + (sources.usda.ok ? "couldn't read it" : sources.usda.error));
  return { bids, usda };
}

// Any other ZIP: Claude searches for the nearest elevators that post bids.
async function localAnywhere({ apiKey, zip, place, prev, problems }) {
  let m;
  try {
    m = (await researchLocal({ apiKey, zip, place })).data || {};
  } catch (e) {
    problems.push("Local bids: " + errText(e));
    return { bids: prev.bids, usda: prev.usda };
  }
  const prevPosted = (prev.bids && prev.bids.posted) || [];
  const posted = (Array.isArray(m.posted) ? m.posted : [])
    .filter((p) => p && p.name && validClasses(p) && /^https?:\/\//.test(p.url || ""))
    .slice(0, 3)
    .map((p) => addChanges({ name: p.name, location: p.location, asOf: p.asOf, url: p.url, classes: p.classes }, prevPosted.find((q) => q.name === p.name)));
  const callFor = (Array.isArray(m.callFor) ? m.callFor : []).filter((c) => c && c.name).slice(0, 3)
    .map((c) => ({ name: c.name, location: c.location, note: c.note, phone: c.phone || undefined, url: /^https?:\/\//.test(c.url || "") ? c.url : undefined, urlLabel: c.urlLabel || "Website ↗" }));
  if (!posted.length) problems.push("Local bids: couldn't find an elevator near " + place.city + " with bids readable online");
  const bids = posted.length || callFor.length ? { asOf: mtDay(), posted, callFor } : prev.bids;
  let usda = prev.usda;
  if (m.usda && Array.isArray(m.usda.rows) && m.usda.rows.length) {
    usda = { title: m.usda.title || `${place.state} regional ranges`, asOf: m.usda.asOf, url: /^https?:\/\//.test(m.usda.url || "") ? m.usda.url : undefined, note: m.usda.note, rows: m.usda.rows };
  }
  return { bids, usda };
}

export async function runRefresh({ apiKey, zip, trigger }) {
  const place = await placeFor(zip);
  if (!place) throw new Error("ZIP " + zip + " wasn't found");
  const isHome = zip === HOME_ZIP;
  const prev = (await getBriefing(zip)) || {};
  const problems = [];

  const [national, local, news] = await Promise.all([
    refreshNational({ apiKey, problems }),
    isHome ? localChester({ apiKey, prev, problems }) : localAnywhere({ apiKey, zip, place, prev, problems }),
    researchNews({ apiKey, place, isHome, previous: prev }).then((r) => r.data || {}, (e) => { problems.push("News: " + errText(e)); return {}; }),
  ]);

  const out = {
    zip,
    place,
    updatedAt: new Date().toISOString(),
    bids: local.bids,
    usda: local.usda,
    agdirect: national && national.agdirect,
    specialty: { canola: national && national.canola, pulses: national && national.pulses, barley: national && national.barley, canada: national && national.canada, fx: national && national.fx },
    policy: prev.policy,
    banking: prev.banking,
  };
  const posted = (out.bids && out.bids.posted) || [];
  const fut = futuresFrom(posted);
  if (fut.length) out.futures = { source: "From the bid boards above, 10+ min delayed", asOf: posted[0] && posted[0].asOf, items: fut };
  else out.futures = prev.futures;

  if (validNews(news.policy)) out.policy = news.policy.slice(0, 6); else if (!problems.some((p) => p.startsWith("News"))) problems.push("Farm policy news: nothing usable came back");
  if (validNews(news.banking)) out.banking = news.banking.slice(0, 6); else if (!problems.some((p) => p.startsWith("News"))) problems.push("Banking news: nothing usable came back");

  out.lastRun = { trigger, problems };
  await saveBriefing(zip, out);
  return problems;
}

// Runs the refresh with status bookkeeping. Never throws, so Netlify doesn't retry a paid run.
export async function runWithStatus({ zip, trigger }) {
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const status = await getStatus(zip);
  const finish = (lastError) => saveStatus(zip, { ...status, state: "idle", token: null, finishedAt: new Date().toISOString(), lastError });
  if (!apiKey) return finish("ANTHROPIC_API_KEY isn't set in Netlify's environment variables.");
  try {
    const problems = await runRefresh({ apiKey, zip, trigger });
    await finish(problems.length ? problems.join("; ") : null);
  } catch (e) {
    await finish(errText(e));
  }
}
