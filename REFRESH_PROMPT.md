# Daily refresh prompt

These are the instructions the scheduled Claude task runs each weekday morning. They update the `briefing/current` document behind the Claude-hosted page. To refresh the GitHub copy, export that document to `data/briefing.json`.

---

Refresh the data behind the "Hi-Line Morning Desk" artifact. Do not republish the page; only update its database document.

1. **Read the current document.** Use ArtifactData `get` with collection `briefing` and doc_id `current`. Keep its version number and its previous cash prices.

2. **Gather today's data.**
   - **EGT/Bunge Chester cash bids** (https://www.bungeag.com/locations/chester-mt/): every DNS 14% and HRW 11.5% row (delivery month, futures symbol, futures, basis in $/bu, cash) plus the page timestamp, converted from CDT to Mountain time. Use those futures prices for the futures strip.
   - **USDA Montana Daily Elevator Grain Bids** (https://www.ams.usda.gov/mnreports/ams_2771.pdf): the report date, plus the North Central, Golden Triangle and Great Falls rows for DNS 14%, HRW 12%, durum and feed barley where present.
   - **Columbia Grain Chester** (https://columbiagrain.com/location/chester-mt/): try once. If the bids are readable, add them under `bids.posted` and drop Columbia's call-for card. **Stricks Ag** (406-759-6489) posts no bids online, so keep its call-for card as is.
   - **AgDirect rates** (https://www.agdirect.com/rates): the effective date range, plus each financed-amount tier's fixed rate for the 2–3, 4, 5 and 6–7 year terms and its variable rate.
   - **Canola** (https://www.ams.usda.gov/mnreports/ams_2887.pdf): the report date and $/cwt bids for Velva ND (list it first), Enderlin ND, West Fargo ND and Hallock MN, for Current, Nov, Dec, Jan and Mar (or the next five delivery months the report lists), plus the day's change on the current bid.
   - **Pulses** (https://www.ams.usda.gov/mnreports/AMS_2914.pdf): a weekly report, so update only when the report date is newer. Include yellow peas, green peas, lentils (Richlea, Brewer, Pardina) and chickpeas in Min-Dak and PNW: bid range, average and year-ago, in $/cwt.
   - **Farm policy news**: 4–6 items, newest first, preferably from the last two weeks. Cover the farm bill, ag legislation, USDA programs and trade/tariffs that affect Montana wheat, barley, pulses and canola.
   - **Banking news**: 4–6 items. Cover Fed rate decisions, FDIC/OCC/Fed rules, CRA, ag credit surveys, ICBA and Montana Bankers Association news, Montana bank mergers and farmland values.
   - Every news item needs a real URL that was actually retrieved, and a summary of 1–3 sentences in Claude's own words. Never invent figures. Drop items older than about six weeks.

3. **Build the document in this shape:**

```
{ updatedAt (ISO, Mountain offset),
  futures:{source, asOf, items:[{label, symbol, price}]},
  bids:{asOf,
        posted:[{name, location, asOf, url, classes:[{name, rows:[{month, symbol, futures, basis, cash, chg}]}]}],
        callFor:[{name, location, note, phone?, url, urlLabel}]},
  usda:{asOf, url, note, rows:[{cls, region, basis, range, avg}]},
  agdirect:{asOf, url, note, terms:["2–3","4","5","6–7"], tiers:[{amount, fixed:[%...], variable:%}]},
  specialty:{canola:{asOf, url, note, cols:[...], rows:[{loc, vals:[$/cwt...], chg}]},
             pulses:{asOf, url, note, rows:[{crop, region, range, avg, yearAgo}]}},
  policy:[{tag, title, source, date, url, summary}],
  banking:[{tag, title, source, date, url, summary}] }
```

   Wheat prices and basis are numbers in $/bu. On wheat rows, `chg` is today's cash minus the previous document's cash for the same class and month; omit it when there's no match. Save with ArtifactData `set` (`if_version` = the version read in step 1). If the version conflicts, re-read and retry once.

4. **If a source fails**, keep that section's previous data. Don't fabricate anything.
