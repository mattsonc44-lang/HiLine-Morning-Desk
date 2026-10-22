# Hi-Line Morning Desk

A one-page morning briefing for a Hi-Line (Chester, MT) ag lender: wheat futures, Chester elevator cash bids, USDA Montana regional ranges, canola and pulse prices, AgDirect equipment loan rates, and farm-policy and banking headlines.

## Files

| Path | What it is |
|---|---|
| `index.html` | The page. It is self-contained: inline CSS and JS, with Google Fonts as the only outside request. |
| `data/briefing.json` | Today's data snapshot. The page reads this file when it runs outside Claude. |
| `REFRESH_PROMPT.md` | The instructions the scheduled Claude task follows each morning to rebuild the data. |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are. |

## Hosting on GitHub Pages

1. Create a repo and upload everything in this folder, including `.nojekyll`.
2. Go to **Settings → Pages**, set **Source** to *Deploy from a branch*, then pick `main` and `/ (root)`.
3. The page goes live at `https://<user>.github.io/<repo>/`.

To preview it locally, run `python3 -m http.server` in this folder and open http://localhost:8000. If you open `index.html` directly from disk, it can't read the JSON file.

## How the data works

- **Inside Claude** (the hosted artifact): the page reads the live `briefing/current` database document, and its **Refresh now** button starts the scheduled task.
- **On GitHub**: the page loads `data/briefing.json`, and the Refresh button stays hidden. This copy only updates when you commit a new `briefing.json`.

The JSON shape is documented in `REFRESH_PROMPT.md` (step 3).

## Notes

- Bids are snapshots. Call the elevator before you sell.
- The repo is public unless you make it private. Everything in it comes from public sources, but the page is set up for First Bank of Montana's Chester branch, so decide whether you want it public.
