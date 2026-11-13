# Changelog

## V1.01 - November 2026
- First public release.
- Fetches each item's real offer ID before claiming.
- Randomized delays, batch rests, exponential backoff on HTTP 429, circuit breakers, session cap.
- Resume support and duplicate skipping via browser localStorage.
- Instant stop with `stopClaim = true`.
- Added PDF tutorial documentation.
