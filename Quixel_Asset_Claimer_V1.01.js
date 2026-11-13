/* =========================================================================
 * Quixel Asset Claimer  V1.01
 * Creator : Shailesh R. Narnaware
 * Purpose : Patiently adds free Quixel Megascans assets on Fab.com to your
 *           library. Run it in the Chrome DevTools Console on the page:
 *           https://www.fab.com/sellers/Quixel%20Megascans?is_free=1
 * ========================================================================= */
(async () => {
  // ---------------- SETTINGS (all times in milliseconds) ----------------
  const CFG = {
    CLAIM_DELAY: [6000, 12000],     // pause between claims (6-12 s)
    PAGE_DELAY: [8000, 15000],      // pause between catalog pages (8-15 s)
    BATCH_SIZE: 25,                 // claims before a long rest
    BATCH_REST: [180000, 360000],   // long rest (3-6 min)
    MAX_PER_RUN: 300,               // max claims per session
    BACKOFF_START: 120000,          // first wait after a 429 reply (2 min)
    BACKOFF_MAX: 1800000,           // longest wait after repeated 429s (30 min)
    MAX_THROTTLE_HITS: 5,           // abort after this many 429s in a row
    MAX_CONSEC_FAILS: 5             // abort after this many failed items in a row
  };
  // ----------------------------------------------------------------------

  const BASE = 'https://www.fab.com/i/listings';
  const m = location.pathname.match(/\/sellers\/([^/?#]+)/);
  const seller = decodeURIComponent(m ? m[1] : 'Quixel Megascans');
  const DONE_KEY = 'srn_fab_done_v8';
  const CURSOR_KEY = 'srn_fab_cursor_v8';
  const FAIL_KEY = 'srn_fab_failed_v8';
  const load = (k) => new Set(JSON.parse(localStorage.getItem(k) || '[]'));
  const save = (k, s) => localStorage.setItem(k, JSON.stringify([...s]));
  const done = load(DONE_KEY);
  const failed = load(FAIL_KEY);
  let cursor = localStorage.getItem(CURSOR_KEY) || null;

  window.stopClaim = false;   // type  stopClaim = true  in the Console to stop

  const rand = ([a, b]) => a + Math.random() * (b - a);
  const mins = (ms) => (ms / 60000).toFixed(1);
  const csrf = () => {
    const c = document.cookie.match(/(?:^|;\s*)fab_csrftoken=([^;]+)/);
    return c ? c[1] : '';
  };

  // Sleeps in 1-second slices so "stopClaim = true" reacts immediately
  async function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end && !window.stopClaim) {
      await new Promise((r) => setTimeout(r, Math.min(1000, end - Date.now())));
    }
  }

  class Fatal extends Error {}

  // Polite request wrapper: backs off on 429, stops on 401 / 403
  async function call(path, opts = {}) {
    let backoff = CFG.BACKOFF_START;
    for (let hits = 0; hits < CFG.MAX_THROTTLE_HITS; hits++) {
      if (window.stopClaim) throw new Fatal('Stopped by user');
      const res = await fetch(`${BASE}/${path}`, {
        credentials: 'include',
        ...opts,
        headers: {
          accept: 'application/json, text/plain, */*',
          'x-csrftoken': csrf(),
          ...(opts.headers || {})
        }
      });
      if (res.status === 401 || res.status === 403) {
        throw new Fatal(`HTTP ${res.status}: not logged in, terms not accepted, or blocked.`);
      }
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after')) * 1000 || 0;
        const wait = Math.max(ra, backoff) * (1 + Math.random() * 0.2);
        console.warn(`[WAIT] 429 rate limit (${hits + 1}/${CFG.MAX_THROTTLE_HITS}). ` +
                     `Cooling down ${mins(wait)} min...`);
        await sleep(wait);
        backoff = Math.min(backoff * 2, CFG.BACKOFF_MAX);
        continue;
      }
      return res;
    }
    throw new Fatal('Too many rate-limit (429) replies in a row. Try again later.');
  }

  async function claim(listItem) {
    const dRes = await call(listItem.uid);          // 1) item details -> real offerId
    if (!dRes.ok) return { ok: false, why: `detail ${dRes.status}` };
    const detail = await dRes.json();
    const licenses = detail.licenses || [];
    if (!licenses.length) return { ok: false, why: 'no licenses in detail' };

    const ordered = [
      ...licenses.filter((l) => l.slug === 'professional'),
      ...licenses.filter((l) => l.slug !== 'professional')
    ];
    await sleep(rand([800, 2000]));                 // small human-like pause

    let lastWhy = '';
    for (const lic of ordered) {                    // 2) add to library
      if (!lic.offerId) continue;
      const fd = new FormData();
      fd.append('offer_id', lic.offerId);
      const cRes = await call(`${listItem.uid}/add-to-library`, { method: 'POST', body: fd });
      if (cRes.ok) return { ok: true };
      const txt = await cRes.text();
      lastWhy = `${cRes.status} ${txt.slice(0, 150)}`;
      if (/already|owned|exist/i.test(txt) || cRes.status === 409) {
        return { ok: true, owned: true };
      }
    }
    return { ok: false, why: lastWhy || 'no usable offerId' };
  }

  let claimed = 0, skipped = 0, failCount = 0, consecFails = 0, sinceRest = 0;
  const startTime = Date.now();
  console.log(`>> Quixel Asset Claimer V1.01 | Seller: "${seller}" | ` +
              `already saved by script: ${done.size} | session cap: ${CFG.MAX_PER_RUN}`);

  try {
    outer:
    while (!window.stopClaim) {
      const q = new URLSearchParams({ is_free: '1', seller, sort_by: 'listingTypeWeight' });
      if (cursor) q.set('cursor', cursor);
      const sRes = await call(`search?${q}`);
      if (!sRes.ok) {
        if (cursor) {
          console.warn('Saved page position rejected, restarting from page 1.');
          cursor = null;
          localStorage.removeItem(CURSOR_KEY);
          continue;
        }
        throw new Fatal(`Search failed: HTTP ${sRes.status}`);
      }
      const page = await sRes.json();
      const results = page.results || [];
      console.log(`[PAGE] ${results.length} items`);
      if (!results.length) { console.log('[DONE] No more items.'); break; }

      for (const item of results) {
        if (window.stopClaim) break outer;
        if (done.has(item.uid) || failed.has(item.uid)) { skipped++; continue; }

        if (claimed >= CFG.MAX_PER_RUN) {
          console.log(`[STOP] Session cap of ${CFG.MAX_PER_RUN} reached. Re-run later.`);
          break outer;
        }

        const r = await claim(item);
        if (r.ok) {
          claimed++; sinceRest++; consecFails = 0;
          done.add(item.uid);
          save(DONE_KEY, done);
          console.log(`[OK] #${claimed} ${r.owned ? 'Already owned' : 'Claimed'}: ${item.title}`);
        } else {
          failCount++; consecFails++;
          failed.add(item.uid);
          save(FAIL_KEY, failed);
          console.warn(`[FAIL] ${item.title} -> ${r.why}`);
          if (consecFails >= CFG.MAX_CONSEC_FAILS) {
            throw new Fatal(`${CFG.MAX_CONSEC_FAILS} failures in a row. Stopping to be safe.`);
          }
        }

        if (sinceRest >= CFG.BATCH_SIZE) {
          const rest = rand(CFG.BATCH_REST);
          console.log(`[REST] Batch of ${CFG.BATCH_SIZE} done. Resting ${mins(rest)} min...`);
          await sleep(rest);
          sinceRest = 0;
        } else {
          await sleep(rand(CFG.CLAIM_DELAY));
        }
      }

      const next = page.cursors && page.cursors.next;
      if (!next || next === cursor) {
        console.log('[DONE] Reached last page.');
        localStorage.removeItem(CURSOR_KEY);
        break;
      }
      cursor = next;
      localStorage.setItem(CURSOR_KEY, cursor);
      await sleep(rand(CFG.PAGE_DELAY));
    }
  } catch (e) {
    console.error(e instanceof Fatal ? `[STOP] ${e.message}` : e);
  }

  console.log(`[END] Session over (${mins(Date.now() - startTime)} min). ` +
              `Claimed: ${claimed} | Skipped: ${skipped} | Failed: ${failCount} | ` +
              `Total saved so far: ${done.size}`);
})();
