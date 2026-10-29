# Hi-Line Morning Desk

One page for the morning: Chester-area elevator bids, wheat futures, USDA Montana ranges, canola and pulse prices, AgDirect equipment rates, farm policy news and banking news.

## How it works

- `public/index.html` is the page. It loads `/api/data?zip=…` and polls while a refresh is running.
- **ZIP codes.** The page opens to Chester (59522). Anyone can type another ZIP; the link `?zip=68801` opens straight to that ZIP, and **Copy link** copies it. The browser remembers the last ZIP used.
  - **59522** reads the Chester elevator pages directly (EGT/Bunge, Columbia Grain) and the USDA Montana report.
  - **Any other ZIP** has Claude search for the 2–3 nearest elevators that post bids online, plus that state's USDA daily grain report, and finds state-specific policy and banking news. The first time someone opens a new ZIP, a refresh starts automatically.
  - AgDirect rates, canola and pulse prices are shared by every ZIP and refreshed at most every 6 hours.
- `Netlify/functions/scheduled-refresh.mjs` runs weekdays at 14:50 UTC (8:50 AM MDT / 7:50 AM MST) for 59522 plus the ZIPs opened in the last 7 days (up to `MAX_SCHEDULED_ZIPS`, default 10).
- The **Refresh now** button posts to `/api/refresh`: 5-minute cooldown per ZIP, and manual plus first-look refreshes across all ZIPs are capped at `MAX_REFRESHES_PER_DAY` (default 30).
- Refreshes run in `refresh-background.mjs` and save to Netlify Blobs. If a source fails, the previous numbers for that section stay up and the gap shows under the Refresh button.
- `seed/briefing.json` is shown for 59522 until the first refresh runs.

## Setup

1. In Netlify: **Add new site → Import an existing project → GitHub → hiline-desk**. Build settings come from `netlify.toml`; leave them as is.
2. **Site configuration → Environment variables → Add a variable**: `ANTHROPIC_API_KEY` = your key from console.anthropic.com. Scope: Functions (or all).
3. Redeploy (Deploys → Trigger deploy) so the functions pick up the key.
4. Open the site and press **Refresh now** once to confirm it works.

## Cost

A Chester refresh runs about $0.30–0.60 in Claude API usage; another ZIP runs about $0.50–1.00 because it searches for elevators too. Weekday mornings for Chester alone come to about $7–13 a month. Each extra ZIP people use regularly adds about $10–20 a month, and the two caps above put a ceiling on it.

Optional environment variables: `MAX_REFRESHES_PER_DAY` (default 30), `MAX_SCHEDULED_ZIPS` (default 10).

## Changing things

- Sources and URLs: `Netlify/lib/sources.mjs`
- Elevator cards, notes: `STATIC` in `Netlify/lib/refresh.mjs`
- What news to look for: `researchNews` in `Netlify/lib/claude.mjs`
- Schedule: `config.schedule` in `Netlify/functions/scheduled-refresh.mjs` (UTC)
