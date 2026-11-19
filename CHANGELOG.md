# Changelog

## Blaze V1.00 - November 2026 (new, separate file)
- New fast edition: `Fab_Asset_Claimer_Blaze_V1.00.js` (guide: `docs/Fab_Asset_Claimer_Blaze_V1.00.pdf`).
- Claims several items at once (presets FAST = 2, BLAZE = 4) with no fixed waiting time.
- Self-adjusting speed: slows down and cools off when Fab says "too many requests", speeds up after calm,
  stops after 3 pushbacks within 3 minutes.
- Five layers that skip items you already own; shares its memory with the normal edition.
- Same login check, preview check, colored messages, refresh guard, status box and CSV report.
- Note: tested against simulated Fab responses only, not yet on live pages. Higher risk than the normal edition.
- README: new "Choose your edition" table. Blaze guide uses a red theme and explains the two editions share one repository.

## V1.05 - November 2026
- Live countdown in the on-page status box for every pause, e.g. "Resting, 3:20 left", "Next item in 7 s",
  "Fab asked to slow down - cooling down, 5:10 left", "Preview check - starting in 8 s".
- Status box now shows the action on the first line and Claimed | Owned | Failed on the second line.
- Documentation: new "The Status Box" page with a picture of the box and a table of every message.

## V1.04 - November 2026
- Color-coded Console messages: green = all good, blue = information, yellow = small issue (the script
  keeps going), red = serious problem (the script stopped). The on-page status box border uses the same colors.
- Plain-language activity log: start-up steps 1-4, which item is being claimed, planned rests, what to do next.
- Fixed: the optional "already owned?" check could trigger a red "400 (Bad Request)" line from the browser.
  It now asks in small groups and switches itself off (yellow [SKIP]) if Fab refuses it.
- Stopping the script yourself now shows a calm green message instead of an error.
- Documentation: new "Understanding the Colors" page and a full "Common Bugs & Troubleshooting" section.

## V1.03 - November 2026
- Project renamed from "Quixel Asset Claimer" to **Fab Asset Claimer**.
- Browsers: Chrome, Brave and Firefox (desktop). Browser is detected and written to the report.
- Login check: verifies that Fab accepts your session before the first claim; stops with clear
  fix instructions on HTTP 401/403 or when not logged in.
- CSV session report saved to the browser's Downloads folder after every session (date/time,
  session details, page link, item title/ID/link, status, summary). A session cut off by a refresh or
  closed tab is saved as `..._RECOVERED.csv` on the next run. `fabSaveReport()` saves a snapshot.
- Refresh guard (browser asks before leaving the page) and an on-page status box with a Stop button.
- Skips items already in your library using one bulk request per page when Fab provides the data.
- Note: Brave/Firefox support, the login check and the report were tested against simulated Fab
  responses, not yet on every live page or browser.

## V1.02 - November 2026
- Works on 15 Fab pages: the Quixel Megascans seller page and 14 free-category pages.
- Reuses the page's own search request; backup search built from the page address.
- Preview check (10 s) before the first claim; every search forced to `is_free=1`.
- Skips items flagged as owned; prefers the free licence; per-page saved position.

## V1.01 - November 2026
- First public release (as "Quixel Asset Claimer").
- Fetches each item's real offer ID before claiming.
- Randomized delays, batch rests, exponential backoff on HTTP 429, circuit breakers, session cap.
- Resume support and duplicate skipping via browser localStorage.
- Instant stop with `stopClaim = true`. Added PDF tutorial documentation.
