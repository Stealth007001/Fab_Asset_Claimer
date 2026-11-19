# Fab Asset Claimer

A patient, rate-limit-friendly browser script that adds **free assets on Fab.com** to your library -
the Quixel Megascans seller page and 14 free-category pages - one at a time, at a human pace, instead of
clicking "Add to My Library" thousands of times by hand. Every session saves a **CSV report**.

**Creator:** Shailesh R. Narnaware

> Unofficial helper. Not affiliated with, endorsed by, or sponsored by Epic Games, Fab or Quixel.

## Choose your edition

Two editions live in this repository. Pick the one that fits your need - they share the same pages, browsers,
CSV report and saved progress, so you can switch at any time.

| | **Normal edition** | **Blaze edition** |
|---|---|---|
| Script | `Fab_Asset_Claimer_V1.05.js` | `Fab_Asset_Claimer_Blaze_V1.00.js` |
| Speed | One item every 6-12 s, with rests | Several items at once, no fixed waiting |
| Risk of hitting Fab's limits | Low | Higher (it slows itself down when Fab pushes back) |
| Best for | Long, unattended runs | Quick catch-up while you watch |
| Guide | [PDF](docs/Fab_Asset_Claimer_V1.05.pdf) | [PDF](docs/Fab_Asset_Claimer_Blaze_V1.00.pdf) |

**Not sure? Start with the normal edition.** Do not run both editions at the same time.

> **Blaze risk:** much faster means much more likely to hit Fab's limits. Blaze was tested against simulated
> responses only, not yet on live Fab pages. No script can guarantee an account will never be limited or flagged.

The sections below describe the **normal edition**. Blaze works the same way (same pages, same browsers, same CSV
report); see its guide for the differences.

## Supported browsers (desktop only)

| Browser | Status | Console shortcut |
|---|---|---|
| Google Chrome | Supported (claim method live-tested) | F12 or Ctrl+Shift+J |
| Brave | Supported (Chromium, same as Chrome) | F12 or Ctrl+Shift+J |
| Mozilla Firefox | Supported (standard features) | F12 or Ctrl+Shift+K |
| Microsoft Edge | Should work (Chromium), not tested | F12 or Ctrl+Shift+J |
| Safari, phones, tablets | Not supported | - |

## Supported pages

Open **one** of these pages (all end in `?is_free=1`), then run the script:

- [Quixel Megascans](https://www.fab.com/sellers/Quixel%20Megascans?is_free=1)
- Categories (`https://www.fab.com/category/<name>?is_free=1`): `3d-model`, `animation`, `audio`, `brush`,
  `decal`, `game-system`, `game-template`, `hdri`, `material`, `sprites-and-flipbooks`, `tool-and-plugin`,
  `tutorials-examples`, `ui`, `vfx`

## Highlights

- **Live status box** - a small box on the page counts down every pause (for example "Resting, 3:20 left")
  and shows Claimed | Owned | Failed; its border turns yellow or red when something needs attention.
- **Color-coded messages** - green = all good, blue = information, yellow = small issue (keeps going),
  red = serious problem (stopped). Every step is explained in plain words.
- **Login verified first** - stops with fix instructions if Fab does not accept your login.
- **CSV session report** - date/time, session details, page link and every item claimed / owned / failed.
- **Patient, randomized timing** - 6-12 s between claims, 8-15 s between pages, 3-6 min rest every 25 claims.
- **Rate-limit backoff and circuit breakers** - waits 2, 4, 8... min (max 30) on HTTP 429; stops on 401/403,
  5 rate-limit hits in a row, or 5 failed items in a row.
- **Preview check** - prints the first item names and waits 10 s before the first claim.
- **Resume and duplicate skipping** - each page keeps its own position; claimed items are shared across pages.
- **Refresh guard** - the browser asks before you reload or close the page while it runs.

## Quick start

1. Log in at <https://www.fab.com> in your browser and check your profile icon is visible. Manually add one
   free item once (accepts Fab's terms).
2. Open one of the supported pages above.
3. Press **F12**, open the **Console** tab, type `allow pasting` and press Enter (needed once per browser).
4. Open `Fab_Asset_Claimer_V1.05.js`, copy everything, paste into the Console, press **Enter**.
   (Firefox: if nothing happens, press Ctrl+B for the multi-line editor, paste, then Ctrl+Enter.)
5. Compare the `[CHECK]` item names with the page; if they do not match, type `stopClaim = true`.
6. **Do not refresh, close or leave the page while it runs** - the script lives inside that page and stops
   immediately. If it happens, run the script again: it resumes.
7. To stop: click **Stop** in the status box, or type `stopClaim = true` and press Enter.

## Session report (CSV)

After every session a file `Fab_Asset_Claimer_Session_YYYY-MM-DD_HH-MM-SS.csv` is saved to your browser's
**Downloads folder** (web pages cannot choose a folder; set your browser's download location to the Desktop
if you prefer). Open it in Excel. A session cut off by a refresh is saved as `..._RECOVERED.csv` on the next
run. Type `fabSaveReport()` in the Console to save a snapshot at any time.

Full illustrated tutorial: [`docs/Fab_Asset_Claimer_V1.05.pdf`](docs/Fab_Asset_Claimer_V1.05.pdf)

## Settings

All settings are in the `CFG` block at the top of the script (times in milliseconds): `CLAIM_DELAY`,
`PAGE_DELAY`, `BATCH_SIZE`, `BATCH_REST`, `MAX_PER_RUN`, `START_DELAY`, `BACKOFF_START`, `BACKOFF_MAX`,
`MAX_THROTTLE_HITS`, `MAX_CONSEC_FAILS`. Please do not shorten the delays - the slow pace keeps the script
gentle on the server.

## Reading the Console colors

| Color | Meaning |
|---|---|
| Green | All good (item claimed, login verified, report saved) |
| Blue | Information: what the script is doing, planned rests |
| Yellow | Small issue - the script keeps running by itself |
| Red | Serious problem - the script has stopped; read the message and follow the fix |

## Troubleshooting

The PDF has a full "Common Bugs & Troubleshooting" section. The most common cases:

- **HTTP 401 / "not logged in"**: log in at fab.com in the same browser window, add one free item by hand and
  accept any terms window, then run again.
- **Red `GET ... 400 (Bad Request)` line or a badge like "616 errors"**: printed by the browser / the Fab
  website, not by the script. Only the colored tags from the script matter.
- **No CSV appeared**: check the browser's Downloads folder; allow downloads for fab.com; if asked, allow
  multiple downloads.

## Disclaimer

Automated access may be restricted by Fab's terms of service, and no script can guarantee an account will
never be flagged. Use at your own risk. Fab can change its website at any time, which may require updating
the script. Brave/Firefox support, category pages, the login check and the report were tested against
simulated responses and not yet on every live page or browser. Last updated: November 2026.

## License

MIT - see [LICENSE](LICENSE).
