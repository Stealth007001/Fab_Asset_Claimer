# Quixel Asset Claimer V1.01

A patient, rate-limit-friendly browser script that adds the **free Quixel Megascans assets on Fab.com** to your
library, one at a time, at a human pace - instead of clicking "Add to My Library" thousands of times by hand.

**Creator:** Shailesh R. Narnaware

> Unofficial helper. Not affiliated with, endorsed by, or sponsored by Epic Games, Fab or Quixel.

## Highlights

- **Correct claim method** - reads each item's real offer ID from its own details before claiming.
- **Patient, randomized timing** - 6-12 s between claims, 8-15 s between pages, 3-6 min rest after every 25 claims.
- **Smart rate-limit backoff** - on HTTP 429 it waits 2, 4, 8, 16... minutes (max 30) and honours `Retry-After`.
- **Circuit breakers** - stops on 401/403, after 5 rate-limit hits in a row, or after 5 failed items in a row.
- **Resume and duplicate skipping** - remembers claimed items and page position in your browser.
- **Instant safe stop** - type `stopClaim = true` in the Console.

## Quick start

1. Use Google Chrome, log in at <https://www.fab.com> and manually add one free item once (accepts Fab's terms).
2. Open <https://www.fab.com/sellers/Quixel%20Megascans?is_free=1>
3. Press **F12**, open the **Console** tab (type `allow pasting` + Enter if Chrome asks).
4. Open `Quixel_Asset_Claimer_V1.01.js`, copy everything, paste into the Console, press **Enter**.
5. To stop: type `stopClaim = true` and press Enter. Run again later to resume.

Full illustrated tutorial: [`docs/Quixel_Asset_Claimer_V1.01.pdf`](docs/Quixel_Asset_Claimer_V1.01.pdf)

## Settings

All settings are in the `CFG` block at the top of the script (times in milliseconds):
`CLAIM_DELAY`, `PAGE_DELAY`, `BATCH_SIZE`, `BATCH_REST`, `MAX_PER_RUN`, `BACKOFF_START`, `BACKOFF_MAX`,
`MAX_THROTTLE_HITS`, `MAX_CONSEC_FAILS`. Please do not shorten the delays - the slow pace is what keeps the
script gentle on the server.

## Disclaimer

Automated access may be restricted by Fab's terms of service, and no script can guarantee an account will never
be flagged. Use at your own risk. Fab can change its website at any time, which may require updating the script.
Last verified: November 2026.

## License

MIT - see [LICENSE](LICENSE).
