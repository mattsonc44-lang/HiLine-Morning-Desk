// Calls the Claude API: read fixed market pages into numbers, research local bids for any ZIP,
// and research + summarize the news.
const API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5-5";

async function callClaude({ apiKey, system, user, tools, maxTokens = 16000 }) {
  const messages = [{ role: "user", content: user }];
  let last;
  // A long search turn can come back as pause_turn; send it back unchanged to let it continue.
  for (let i = 0; i < 6; i++) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages, tools }),
      signal: AbortSignal.timeout(8 * 60 * 1000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body && body.error ? `${body.error.type}: ${body.error.message}` : `HTTP ${res.status}`;
      throw new Error("Claude API " + msg);
    }
    last = body;
    if (body.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: body.content });
      continue;
    }
    break;
  }
  const text = (last.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const all = [...text.matchAll(/<json>([\s\S]*?)<\/json>/g)];
  const raw = all.length ? all[all.length - 1][1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return { data: JSON.parse(raw), usage: last.usage };
  } catch {
    throw new Error("Claude's answer wasn't valid JSON");
  }
}

function nowMT() {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date());
}

const where = (p) => `${p.city}, ${p.st}`;

// ---------- Fixed sources (national data + the Chester elevators) ----------

const EXTRACT = {
  egt: {
    ask: "egt: every DNS 14% and HRW (whatever protein the board lists) row from the Bunge/EGT Chester page: delivery month (3-letter), futures symbol without \"@\", futures price, basis in $/bu (negative numbers), cash price. Plus the page's \"as of\" time converted to MT.",
    shape: `"egt": null | { "asOf": "Oct 22, 9:51 AM MT", "classes": [ { "name": "DNS 14%", "rows": [ { "month": "Oct", "symbol": "MWZ26", "futures": 6.4625, "basis": -0.50, "cash": 5.9625 } ] } ] }`,
  },
  columbia: {
    ask: "columbia: only if real Chester bids appear in that text, same shape as egt; otherwise null.",
    shape: `"columbia": null | same shape as egt`,
  },
  usda: {
    ask: "usda: report date, and North Central, Golden Triangle and Great Falls rows for DNS/HRS 14%, HRW 12%, durum and feed barley where present. Basis as the report shows it in cents (e.g. \"-65 to -58\", empty string if none), price range shortened to 2 decimals with an en dash, average to 2 decimals.",
    shape: `"usda": null | { "asOf": "Report of Oct 20, 2026", "rows": [ { "cls": "DNS 14%", "region": "North Central", "basis": "-65 to -58", "range": "5.97–6.04", "avg": "6.00" } ] }`,
  },
  agdirect: {
    ask: "agdirect: the effective date range and, for each financed-amount tier (largest first), the fixed rate for each term column in order and the variable rate, as numbers in percent.",
    shape: `"agdirect": null | { "asOf": "Effective Oct 1–31, 2026", "terms": ["2–3","4","5","6–7"], "tiers": [ { "amount": "$250,000+", "fixed": [7.25,7.25,7.25,7.5], "variable": 6.25 } ] }`,
  },
  canola: {
    ask: "canola: report date; bids in $/cwt for every plant listed (Velva ND first if present); use the first five delivery columns the report lists as cols (first one usually \"Current\"); chg = the day's change on the first column as a signed number.",
    shape: `"canola": null | { "asOf": "USDA report of Oct 21, 2026", "cols": ["Current","Nov","Dec","Jan","Mar"], "rows": [ { "loc": "Velva, ND", "vals": [23.91,24.10,24.30,24.50,24.96], "chg": -0.25 } ] }`,
  },
  pulses: {
    ask: "pulses: report date; yellow peas, green peas, Richlea, Brewer and Pardina lentils, and chickpeas (garbanzos) for Min-Dak and PNW where listed: bid range string, average and year-ago as numbers ($/cwt).",
    shape: `"pulses": null | { "asOf": "USDA weekly review of Oct 19, 2026", "rows": [ { "crop": "Yellow peas", "region": "Min-Dak", "range": "7.92–11.67", "avg": 9.24, "yearAgo": 8.83 } ] }`,
  },
};

export async function extractFixed({ apiKey, sources, srcMeta }) {
  const keys = Object.keys(sources);
  const blocks = keys.map((k) => {
    const r = sources[k], meta = srcMeta[k];
    return r.ok
      ? `<source key="${k}" url="${meta.url}" title="${meta.label}">\n${r.text}\n</source>`
      : `<source key="${k}" url="${meta.url}" title="${meta.label}">FETCH FAILED: ${r.error}</source>`;
  }).join("\n\n");

  const system = "You extract market data for an ag lender's morning page. Accuracy matters more than completeness: copy numbers exactly as they appear in the source; never estimate, round differently, or invent. If a section's data is missing or unreadable, return null for that section. Times on Bunge pages are Central; convert to Mountain (subtract 1 hour) and label \"MT\".";

  const retryable = keys.filter((k) => srcMeta[k].kind === "html");
  const user = `Today is ${nowMT()} (Mountain time).

Below are page texts my server fetched. If an HTML source (${retryable.join(", ") || "none"}) failed or its text has no bid/rate numbers (pages sometimes load data with scripts), you may use web_fetch on that source's URL once to try again. Do not fetch anything else.

Extract:
${keys.map((k) => "- " + EXTRACT[k].ask).join("\n")}

Reply with only the JSON inside <json></json> tags, matching this shape:
{
  ${keys.map((k) => EXTRACT[k].shape).join(",\n  ")}
}

${blocks}`;

  const domains = [...new Set(retryable.map((k) => new URL(srcMeta[k].url).hostname.replace(/^www\./, "")))];
  const tools = domains.length ? [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 3, allowed_domains: domains }] : [];
  return callClaude({ apiKey, system, user, tools });
}

// ---------- Local bids for any ZIP ----------

export async function researchLocal({ apiKey, zip, place }) {
  const system = "You find local grain cash bids for a farmer or ag lender. Accuracy matters more than completeness. Only report a bid you actually saw, with its numbers, on a page you fetched or a search result you read; copy numbers exactly; never estimate or invent. Every URL must be one you actually saw. If you can't find bids, say so with empty lists rather than guessing.";

  const user = `Today is ${nowMT()} (Mountain time). The user's ZIP code is ${zip}: ${place.city}, ${place.state} (lat ${place.lat}, lon ${place.lon}).

1. Find the grain elevators, co-ops and processors nearest to ${where(place)} (ideally within about 60 miles) that post cash bids online. Fetch their bid pages and pick the 2–3 closest ones whose bids you can actually read. Elevator bid widgets often load by script; if a page shows no numbers, try the company's other bid pages, farmbucks.com, or a different nearby buyer.
   For each: name (company — town), location (town or address), asOf (the bid date/time shown, Mountain time if you can convert), url (the bid page), and classes = one per commodity this area grows (e.g. "HRW 12%", "DNS 14%", "Corn", "Soybeans", "Canola", "Barley"), each with up to 6 delivery rows: month (3-letter), futures symbol if shown (without "@"), futures price, basis in $/bu (negative for under), cash price in $/bu. Use null for a field the page doesn't show.
2. List 1–3 other nearby buyers that don't post bids online as callFor cards: name, location, a one-line note, phone if you found it, and url (their website).
3. Find the USDA AMS state daily grain bids report covering ${place.state} (or the nearest state that has one) on ams.usda.gov/mnreports or mymarketnews.ams.usda.gov. From the latest edition, give the regions nearest ${where(place)} with each class: basis as the report shows it in cents, price range (2 decimals, en dash), average (2 decimals). Title it like "${place.state} regional ranges". null if there isn't one.

Reply with only JSON inside <json></json> tags:
{
  "posted": [ { "name": "", "location": "", "asOf": "", "url": "", "classes": [ { "name": "", "rows": [ { "month": "Oct", "symbol": "KWZ26", "futures": 6.69, "basis": -0.95, "cash": 5.74 } ] } ] } ],
  "callFor": [ { "name": "", "location": "", "note": "", "phone": "", "url": "", "urlLabel": "Website ↗" } ],
  "usda": null | { "title": "", "asOf": "Report of Oct 20, 2026", "url": "", "note": "one sentence on what the ranges are and which region is closest", "rows": [ { "cls": "", "region": "", "basis": "", "range": "", "avg": "" } ] }
}`;

  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 8, user_location: { type: "approximate", city: place.city, region: place.state, country: "US" } },
    { type: "web_fetch_20250910", name: "web_fetch", max_uses: 10 },
  ];
  return callClaude({ apiKey, system, user, tools });
}

// ---------- News ----------

export async function researchNews({ apiKey, place, isHome, previous }) {
  const prevList = (arr) => (Array.isArray(arr) ? arr : []).map((n) => `- ${n.date} | ${n.title} | ${n.url}`).join("\n") || "(none)";
  const reader = isHome
    ? "a branch manager and ag lender at a community bank in Chester, Montana, on the Hi-Line. His customers grow spring and winter wheat, durum, barley, canola and pulses, and run cattle."
    : `farmers, ranchers and ag lenders around ${where(place)}. Figure out from your research what the main crops and livestock are in that area and weigh the news toward them.`;
  const system = `You are the research desk for ${reader} You find news that matters to them and summarize it accurately and briefly in your own words. Never quote more than a few words from a source. Every item must have a real URL you saw in your search or fetch results; never construct or guess a URL. Never invent facts, figures, or dates.`;

  const user = `Today is ${nowMT()} (Mountain time).

Find the current, most useful items for two lists:

1. policy (4–6 items): farm bill status and negotiations, ag legislation in Congress, USDA programs and payments, crop insurance, trade and tariffs affecting the crops grown around ${where(place)}, fuel or input relief, and ${place.state} ag policy. Good sources: farmdoc Farm Policy News, Agri-Pulse, DTN, Brownfield, Successful Farming, state farm bureau and commodity groups, ${place.state} ag news outlets, USDA press releases.

2. banking (4–6 items): what affects a small community and ag bank in ${place.state}: Federal Reserve rate decisions and outlook, FDIC/OCC/Fed rules, CRA, deposit and liquidity trends, ag credit conditions (the regional Federal Reserve bank's ag credit survey for ${place.state}), farmland values, ICBA and ${place.state} bankers association news, ${place.state} bank mergers or failures.

Prefer items from the last two weeks; never include anything older than six weeks. Newest first. Previously shown items are below; keep one only if it's still among the most relevant, and keep its wording unless facts changed.

Previously shown policy:
${prevList(previous && previous.policy)}

Previously shown banking:
${prevList(previous && previous.banking)}

For each item: tag (one or two words, e.g. "Farm bill", "Trade", "Fed", "Ag credit", "Regulation"), title (your own short headline), source (publication name), date ("Oct 21" style), url, summary (1–3 plain sentences on what happened and why it matters to a lender or farmer around ${where(place)}).

Reply with only JSON inside <json></json> tags: {"policy":[{"tag","title","source","date","url","summary"}],"banking":[...]}`;

  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 10, user_location: { type: "approximate", city: place.city, region: place.state, country: "US" } },
    { type: "web_fetch_20250910", name: "web_fetch", max_uses: 6 },
  ];
  return callClaude({ apiKey, system, user, tools });
}
