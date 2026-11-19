/* =========================================================================
 * Fab Asset Claimer BLAZE  V1.00
 * Creator : Shailesh R. Narnaware
 * Purpose : The FAST edition of Fab Asset Claimer. Claims several free assets
 *           at once with no fixed waiting time, and skips everything you
 *           already own. Same pages, same CSV report, same login check.
 * Speed   : Starts at full speed and slows itself down the moment Fab says
 *           "too many requests". It stops completely if Fab keeps pushing back.
 * Browsers: Chrome, Brave, Firefox (desktop). Paste into the DevTools Console
 *           while a supported Fab page is open and you are logged in to Fab.
 * Colors  : GREEN = all good | BLUE = information | YELLOW = small issue,
 *           the script keeps going | RED = serious problem, script stopped.
 * WARNING : Do NOT refresh, close or leave the page while the script runs.
 * RISK    : Much faster than the normal edition = much more likely to trigger
 *           Fab's limits. Use the normal edition for long unattended runs.
 * ========================================================================= */
(async () => {
  const VERSION = 'V1.00';

  // ---------------- SETTINGS (times in milliseconds) ----------------
  const PRESET = 'BLAZE';                      // 'FAST' (gentler) or 'BLAZE' (full speed)
  const PRESETS = {
    FAST: { CONCURRENCY: 2, MIN_GAP: 400 },    // 2 claims at once, 1 request per 0.4 s
    BLAZE: { CONCURRENCY: 4, MIN_GAP: 150 }    // 4 claims at once, 1 request per 0.15 s
  };
  const CFG = {
    ...PRESETS[PRESET],
    PAGE_DELAY: [200, 400],         // tiny pause between catalog pages
    MAX_PER_RUN: 1000,              // max claims per session
    START_DELAY: 5000,              // abort window after the preview check (0 = none)
    BACKOFF_START: 60000,           // first cool-down after "too many requests" (1 min)
    BACKOFF_MAX: 1800000,           // longest cool-down (30 min)
    MAX_429_EVENTS: 3,              // stop if Fab pushes back this many times ...
    WINDOW_MS: 180000,              // ... within this time (3 min)
    RAMP_UP_AFTER: 45000,           // speed up one step after this long without pushback
    MAX_CONSEC_FAILS: 8,            // stop after this many real failures in a row
    MAX_CONSEC_SKIPS: 40,           // stop after this many "not claimable" items in a row
    STATE_CHUNK: 6                  // items per "already owned?" check request
  };
  // ------------------------------------------------------------------

  // ---------- colored Console messages ----------
  const PILL = 'padding:1px 6px;border-radius:3px;font-weight:bold;';
  const LOOK = {
    ok: [PILL + 'background:#16a34a;color:#fff', 'color:#16a34a;font-weight:bold'],
    info: [PILL + 'background:#2563eb;color:#fff', ''],
    warn: [PILL + 'background:#f5c518;color:#000', ''],
    err: [PILL + 'background:#dc2626;color:#fff', 'font-weight:bold']
  };
  function say(kind, tag, msg) {
    const [pill, text] = LOOK[kind];
    const args = ['%c %s %c %s', pill, tag, text, msg];
    if (kind === 'warn') console.warn(...args);
    else if (kind === 'err') console.error(...args);
    else console.log(...args);
  }

  if (location.hostname !== 'www.fab.com') {
    say('err', 'STOP', 'Open a https://www.fab.com/... page (with www) first, then run the script.');
    return;
  }

  const BASE = 'https://www.fab.com/i/listings';
  const STATES_URL = 'https://www.fab.com/i/users/me/listings-states';
  const DONE_KEY = 'srn_fab_done_v8';       // shared with the normal edition
  const FAIL_KEY = 'srn_fab_failed_v8';
  const CURSOR_PREFIX = 'srn_fab_cursor_v102:';
  const SESSION_KEY = 'srn_fab_session_blaze1';
  const LOGIN_HELP = 'Fab did not accept your login. Fix: (1) log in at www.fab.com in THIS ' +
    'browser window, (2) click "Add to My Library" by hand on one free item and accept any ' +
    'terms window, (3) run the script again. If it repeats, wait a few hours first.';

  const load = (k) => new Set(JSON.parse(localStorage.getItem(k) || '[]'));
  const save = (k, s) => localStorage.setItem(k, JSON.stringify([...s]));
  const done = load(DONE_KEY);
  const failed = load(FAIL_KEY);

  window.stopClaim = false;   // type  stopClaim = true  in the Console to stop

  const rand = ([a, b]) => a + Math.random() * (b - a);
  const mins = (ms) => (ms / 60000).toFixed(1);
  const secs = (ms) => Math.round(ms / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (x) => {
    const d = new Date(x);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const stamp = (x) => fmt(x).replace(' ', '_').replace(/:/g, '-');
  const clock = (ms) => `${Math.floor(ms / 60000)}:${pad(Math.floor((ms % 60000) / 1000))}`;
  const csrf = () => {
    const c = document.cookie.match(/(?:^|;\s*)fab_csrftoken=([^;]+)/);
    return c ? c[1] : '';
  };

  // Sleeps in 1-second slices so "stopClaim = true" reacts immediately
  async function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end && !window.stopClaim) {
      await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(1, end - Date.now()))));
    }
  }
  async function sleepShow(ms, textFor, kind = 'ok') {
    const end = Date.now() + ms;
    while (Date.now() < end && !window.stopClaim) {
      setBox(textFor(Math.max(0, end - Date.now())), kind);
      await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(1, end - Date.now()))));
    }
  }

  class Fatal extends Error {}

  // ---------- which page are we on? ----------
  const pageParams = new URLSearchParams(location.search);
  const sellerM = location.pathname.match(/\/sellers\/([^/?#]+)/);
  const catM = location.pathname.match(/\/category\/([^/?#]+)/);
  const sellerName = sellerM ? decodeURIComponent(sellerM[1].replace(/\+/g, ' ')) : null;
  const catSlug = catM ? decodeURIComponent(catM[1]) : null;
  const scopeLabel = sellerName ? `seller "${sellerName}"`
                   : catSlug ? `category "${catSlug}"` : 'this page';

  // ---------- which browser? ----------
  async function detectBrowser() {
    const ua = navigator.userAgent;
    if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
      try { if (await navigator.brave.isBrave()) return 'Brave'; } catch (e) { /* ignore */ }
    }
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Edg\//.test(ua)) return 'Edge';
    if (/Chrome\//.test(ua)) return 'Chrome';
    return `Other (${ua.slice(0, 50)})`;
  }

  // ---------- CSV session report ----------
  const q = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;
  const line = (arr) => arr.map(q).join(',');

  function buildCsv(s) {
    const head = ['Session ID', 'Session Started', 'Date-Time', 'Browser', 'Page', 'Page Link',
                  'Item Title', 'Item ID', 'Item Link', 'Status', 'Note'];
    const out = [line(head)];
    for (const r of s.rows) {
      out.push(line([s.id, fmt(s.start), r.dt, s.browser, s.pageName, s.pageUrl,
                     r.title, r.uid, `https://www.fab.com/listings/${r.uid}`, r.status, r.note]));
    }
    const count = (st) => s.rows.filter((r) => r.status === st).length;
    out.push('');
    out.push(line(['SESSION SUMMARY']));
    out.push(line(['Tool', `Fab Asset Claimer Blaze ${VERSION}`]));
    out.push(line(['Session ID', s.id]));
    out.push(line(['Started', fmt(s.start)]));
    out.push(line(['Ended', s.endedAt ? fmt(s.endedAt) : '(interrupted)']));
    out.push(line(['Duration (minutes)',
                   s.endedAt ? mins(new Date(s.endedAt) - new Date(s.start)) : '']));
    out.push(line(['Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone]));
    out.push(line(['Browser', s.browser]));
    out.push(line(['Page', s.pageName]));
    out.push(line(['Page link', s.pageUrl]));
    out.push(line(['Claimed this session', count('Claimed')]));
    out.push(line(['Already owned', count('Already owned')]));
    out.push(line(['Skipped (not claimable / probably owned)', count('Skipped')]));
    out.push(line(['Failed', count('Failed')]));
    out.push(line(['Why it ended',
                   s.endReason || 'Session was interrupted (page closed or refreshed)']));
    return out.join('\r\n');
  }

  function downloadReport(s, suffix = '') {
    try {
      const text = '\ufeff' + buildCsv(s);                 // BOM so Excel reads it correctly
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Fab_Asset_Claimer_Blaze_Session_${stamp(s.start)}${suffix}.csv`;
      a.style.display = 'none';
      document.body.appendChild(a);                        // needed for Firefox
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 5000);
      say('ok', 'REPORT', `Saved ${a.download} to your Downloads folder ` +
          `(${s.rows.length} rows). If the browser asks, click Allow.`);
      return true;
    } catch (e) {
      say('warn', 'WARN', 'Could not save the CSV report automatically. ' +
          'Type  fabSaveReport()  in the Console to try again, and allow downloads for fab.com.');
      return false;
    }
  }

  function recoverOldReport() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const old = JSON.parse(raw);
      if (old && !old.saved && old.rows && old.rows.length) {
        say('info', 'RECOVER', 'The previous session was interrupted - saving its report now.');
        downloadReport(old, '_RECOVERED');
      }
    } catch (e) { /* ignore */ }
  }

  // ---------- on-page status box (border color = status) ----------
  const BOX_COL = { ok: '#FF8A00', info: '#FF8A00', warn: '#F5C518', err: '#DC2626' };
  let box = null, boxLine = null;
  function makeBox() {
    try {
      const old = document.getElementById('fac-box');
      if (old) old.remove();
      box = document.createElement('div');
      box.id = 'fac-box';
      Object.assign(box.style, {
        position: 'fixed', left: '16px', bottom: '16px', zIndex: '2147483647', width: '330px',
        background: '#0B1220', color: '#E6EDF7', border: '2px solid #FF8A00',
        borderRadius: '8px', padding: '10px 12px', font: '12px/1.45 Arial, sans-serif',
        boxShadow: '0 6px 20px rgba(0,0,0,.55)'
      });
      const t = document.createElement('div');
      t.textContent = `Fab Asset Claimer BLAZE ${VERSION} - RUNNING`;
      t.style.fontWeight = 'bold'; t.style.color = '#FF8A00';
      boxLine = document.createElement('div');
      boxLine.style.whiteSpace = 'pre-line';
      boxLine.textContent = 'Starting...';
      const w = document.createElement('div');
      w.textContent = 'Do NOT refresh, close or leave this page.';
      w.style.color = '#FFB020'; w.style.fontWeight = 'bold'; w.style.margin = '4px 0 6px';
      const b = document.createElement('button');
      b.textContent = 'Stop';
      Object.assign(b.style, { background: '#D93838', color: '#fff', border: 'none',
        borderRadius: '4px', padding: '4px 14px', cursor: 'pointer', fontWeight: 'bold' });
      b.onclick = () => { window.stopClaim = true; };
      box.append(t, boxLine, w, b);
      document.body.appendChild(box);
    } catch (e) { box = null; boxLine = null; }
  }
  const setBox = (msg, kind = 'ok') => {                // line 1 = action, line 2 = counts
    try {
      if (!boxLine) return;
      boxLine.textContent = `${msg}\n${counts()}`;
      box.style.borderColor = BOX_COL[kind];
    } catch (e) { /* ignore */ }
  };
  const closeBox = (msg, kind) => {
    try {
      if (!box) return;
      const titles = { ok: 'FINISHED', warn: 'FINISHED WITH WARNINGS', err: 'STOPPED' };
      box.firstChild.textContent = `Fab Asset Claimer BLAZE ${VERSION} - ${titles[kind]}`;
      box.firstChild.style.color = BOX_COL[kind];
      box.style.borderColor = BOX_COL[kind];
      boxLine.textContent = msg;
      box.children[2].textContent = 'You may refresh the page now.';
      box.children[2].style.color = '#8EA0BF';
      box.children[3].remove();
    } catch (e) { /* ignore */ }
  };

  // ---------- speed engine: spacing, cool-downs, automatic slow-down ----------
  const speed = { conc: CFG.CONCURRENCY, gap: CFG.MIN_GAP };
  let nextSlot = 0, pauseUntil = 0, backoff = CFG.BACKOFF_START, last429 = 0, lastSlow = 0;
  const events429 = [];

  async function gate() {                       // keeps requests at least `gap` ms apart
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + speed.gap;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
  async function waitPause() {                  // all requests wait while Fab asked for a break
    while (Date.now() < pauseUntil && !window.stopClaim) {
      await new Promise((r) => setTimeout(r, Math.min(500, pauseUntil - Date.now())));
    }
  }
  function slowDown() {
    speed.conc = Math.max(1, Math.floor(speed.conc / 2));
    speed.gap = Math.min(2000, speed.gap * 2);
    lastSlow = Date.now();
  }
  function maybeSpeedUp() {
    const now = Date.now();
    if (now < pauseUntil || now - lastSlow < CFG.RAMP_UP_AFTER) return;
    if (speed.conc < CFG.CONCURRENCY || speed.gap > CFG.MIN_GAP) {
      speed.conc = Math.min(CFG.CONCURRENCY, speed.conc + 1);
      speed.gap = Math.max(CFG.MIN_GAP, Math.round(speed.gap * 0.7));
      lastSlow = now;
      say('info', 'SPEED', `No pushback from Fab for a while - speeding up ` +
          `(${speed.conc} at once, ${speed.gap} ms between requests).`);
    }
  }

  async function callAbs(url, opts = {}) {
    for (;;) {
      if (window.stopClaim) throw new Fatal('Stopped by user');
      await waitPause();
      await gate();
      if (window.stopClaim) throw new Fatal('Stopped by user');
      const res = await fetch(url, {
        credentials: 'include',
        ...opts,
        headers: {
          accept: 'application/json, text/plain, */*',
          'x-csrftoken': csrf(),
          ...(opts.headers || {})
        }
      });
      if (res.status === 401 || res.status === 403) {
        throw new Fatal(`HTTP ${res.status}. ${LOGIN_HELP}`);
      }
      if (res.status === 429) {
        const now = Date.now();
        if (now >= pauseUntil) {                      // a new pushback event (not a late echo)
          events429.push(now);
          while (events429.length && now - events429[0] > CFG.WINDOW_MS) events429.shift();
          if (events429.length >= CFG.MAX_429_EVENTS) {
            throw new Fatal(`Fab pushed back ${events429.length} times within ` +
              `${mins(CFG.WINDOW_MS)} minutes. Stopping to protect your account and IP. ` +
              'Wait several hours (or until tomorrow), then use the normal edition or the ' +
              'FAST preset.');
          }
          backoff = now - last429 > 120000 ? CFG.BACKOFF_START
                                           : Math.min(backoff * 2, CFG.BACKOFF_MAX);
          last429 = now;
          const ra = Number(res.headers.get('retry-after')) * 1000 || 0;
          const wait = Math.max(ra, backoff) * (1 + Math.random() * 0.2);
          pauseUntil = now + wait;
          slowDown();
          say('warn', 'WAIT', `Fab says "too many requests" (${events429.length}/` +
              `${CFG.MAX_429_EVENTS}). Slowing down to ${speed.conc} at once and cooling down ` +
              `for ${mins(wait)} min, then continuing automatically. Nothing to do.`);
        }
        continue;                                      // retry after the pause
      }
      return res;
    }
  }
  const call = (path, opts) => callAbs(`${BASE}/${path}`, opts);

  // ---------- login check ----------
  async function verifyLogin(sampleUid) {
    try {
      const r = await fetch(`${STATES_URL}?listing_ids=${sampleUid}`, {
        credentials: 'include',
        headers: { accept: 'application/json, text/plain, */*', 'x-csrftoken': csrf() }
      });
      if (r.status === 401 || r.status === 403) return 'no';
      if (r.ok) return 'yes';
    } catch (e) { /* fall through to the page check */ }
    const signIn = [...document.querySelectorAll('a,button')]
      .some((el) => /^\s*(sign in|log in|login)\s*$/i.test(el.textContent || ''));
    return signIn ? 'no' : 'unknown';
  }

  // ---------- which search? ----------
  const hasValue = (params, wanted) => {
    for (const [, v] of params) {
      if (v.split(',').some((x) => x.trim().toLowerCase() === wanted.toLowerCase())) return true;
    }
    return false;
  };
  function fromPageRequest() {
    const names = performance.getEntriesByType('resource')
      .map((e) => e.name).filter((n) => n && n.includes('/i/listings/search'));
    for (let i = names.length - 1; i >= 0; i--) {
      let u;
      try { u = new URL(names[i]); } catch (e) { continue; }
      if (u.searchParams.get('is_free') !== '1') continue;
      if (sellerName && !hasValue(u.searchParams, sellerName)) continue;
      if (catSlug && !hasValue(u.searchParams, catSlug)) continue;
      u.searchParams.delete('cursor');
      return u.searchParams;
    }
    return null;
  }
  function builtFromUrl() {
    const p = new URLSearchParams();
    if (sellerName) { p.set('seller', sellerName); p.set('sort_by', 'listingTypeWeight'); }
    if (catSlug) p.set('listing_types', catSlug);
    for (const [k, v] of pageParams) {
      if (k === 'lang' || k === 'cursor' || k.startsWith('utm_')) continue;
      p.set(k, v);
    }
    return p;
  }

  // ---------- ownership: never claim what you already have ----------
  const OWN_KEY = /^(is_?)?(acquired|owned|in_?library)$/i;
  const LOOSE_KEY = /acqui|own|librar|entitle/i;
  function ownedFlag(o, depth = 0) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || depth > 2) return null;
    for (const [k, v] of Object.entries(o)) {
      if (OWN_KEY.test(k) && v === true) return k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const inner = ownedFlag(v, depth + 1);
        if (inner) return `${k}.${inner}`;
      }
    }
    return null;
  }
  function ownershipFields(o, path = '', depth = 0, out = []) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || depth > 2) return out;
    for (const [k, v] of Object.entries(o)) {
      const p = path ? `${path}.${k}` : k;
      if (LOOSE_KEY.test(k) && (v === null || typeof v !== 'object')) out.push(`${p}=${v}`);
      else if (v && typeof v === 'object') ownershipFields(v, p, depth + 1, out);
    }
    return out;
  }
  let loggedStateFields = false, loggedDetailFields = false;
  const seenOwnedKeys = new Set();
  const noteOwned = (key) => {
    if (!seenOwnedKeys.has(key)) {
      seenOwnedKeys.add(key);
      say('info', 'INFO', `Fab marks owned items with the field "${key}" - those are skipped.`);
    }
  };

  let statesOn = true;
  async function fetchStates(uids) {
    if (!statesOn) return null;
    const map = new Map();
    for (let i = 0; i < uids.length; i += CFG.STATE_CHUNK) {
      const part = uids.slice(i, i + CFG.STATE_CHUNK);
      let j = null;
      try {
        const r = await callAbs(`${STATES_URL}?listing_ids=${part.join(',')}`);
        if (r.ok) j = await r.json();
        else {
          statesOn = false;
          say('warn', 'SKIP', `The "already owned?" shortcut is not available (HTTP ${r.status}). ` +
              'Continuing without it: owned items are then detected when claiming. ' +
              'A red line from the browser above this message is harmless.');
          return map.size ? map : null;
        }
      } catch (e) {
        if (e instanceof Fatal) throw e;
        statesOn = false;
        say('warn', 'SKIP', 'The "already owned?" shortcut failed. Continuing without it.');
        return map.size ? map : null;
      }
      if (j && !Array.isArray(j)) {
        j = j.results || j.listings_states || j.states ||
            Object.entries(j).map(([k, v]) =>
              ({ uid: k, ...(v && typeof v === 'object' ? v : {}) }));
      }
      if (!Array.isArray(j)) continue;
      for (const s of j) {
        const id = s && (s.uid || s.listingId || s.listing_id || s.id);
        if (typeof id === 'string') map.set(id, s);
      }
    }
    if (!loggedStateFields && map.size) {
      loggedStateFields = true;
      say('info', 'INFO', 'Ownership-like fields in state data: ' +
          (ownershipFields([...map.values()][0]).join(' | ').slice(0, 300) || '(none)'));
    }
    return map;
  }

  // ---------- claim one item ----------
  const isZero = (v) => v === 0 || v === '0' || v === '0.00';
  const looksFree = (l) => [l.priceInfo && l.priceInfo.price, l.price].some(isZero) ? 1 : 0;
  const isClientErr = (st) => st >= 400 && st < 500 && st !== 401 && st !== 403 && st !== 429;

  async function claim(item, state) {
    const f0 = ownedFlag(state) || ownedFlag(item);
    if (f0) { noteOwned(f0); return { owned: true, note: `flag ${f0}` }; }

    const dRes = await call(item.uid);                  // 1) details -> real offerId
    if (!dRes.ok) {
      return isClientErr(dRes.status)
        ? { skip: true, why: `details not available (HTTP ${dRes.status})` }
        : { fail: true, why: `could not read item details (HTTP ${dRes.status})` };
    }
    const detail = await dRes.json();
    if (!loggedDetailFields) {
      loggedDetailFields = true;
      say('info', 'INFO', 'Ownership-like fields in detail data: ' +
          (ownershipFields(detail).join(' | ').slice(0, 300) || '(none)'));
    }
    const f2 = ownedFlag(detail);
    if (f2) { noteOwned(f2); return { owned: true, note: `flag ${f2}` }; }

    const licenses = detail.licenses || [];
    if (!licenses.length) return { skip: true, why: 'Fab lists no licence for this item' };
    const ordered = [...licenses].sort((a, b) =>
      (looksFree(b) - looksFree(a)) ||
      ((b.slug === 'professional') - (a.slug === 'professional'))).slice(0, 3);

    let lastWhy = '', lastStatus = 0;
    for (const lic of ordered) {                        // 2) add to library
      if (!lic.offerId) continue;
      const fd = new FormData();
      fd.append('offer_id', lic.offerId);
      const cRes = await call(`${item.uid}/add-to-library`, { method: 'POST', body: fd });
      if (cRes.ok) return { ok: true, note: `license ${lic.slug || '?'}` };
      const txt = await cRes.text();
      lastStatus = cRes.status;
      lastWhy = `Fab refused (HTTP ${cRes.status}) ${txt.slice(0, 120)}`;
      if (/already|owned|exist/i.test(txt) || cRes.status === 409) {
        return { owned: true, note: 'server said already owned' };
      }
    }
    if (!lastStatus) return { skip: true, why: 'no usable offer for this item' };
    return isClientErr(lastStatus) ? { skip: true, why: lastWhy } : { fail: true, why: lastWhy };
  }

  // ---------- main ----------
  const browserName = await detectBrowser();
  recoverOldReport();
  const session = {
    id: `S-${stamp(Date.now())}`, start: new Date().toISOString(), browser: browserName,
    pageName: scopeLabel, pageUrl: location.href, rows: [], saved: false
  };
  const persist = () => {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
  };
  const addRow = (title, uid, status, note) => {
    session.rows.push({ dt: fmt(Date.now()), title, uid, status, note: note || '' });
    persist();
  };
  persist();
  window.fabSaveReport = () => downloadReport(
    { ...session, endedAt: null, endReason: 'Saved manually while running' });

  const guard = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
  window.addEventListener('beforeunload', guard);     // asks before refresh / close
  makeBox();

  let claimed = 0, ownedCount = 0, skippedCache = 0, skippedOdd = 0, failCount = 0;
  let consecFails = 0, consecSkips = 0, active = 0, capReached = false, fatal = null;
  let hadError = false, runStart = 0, phase = 'start', endReason = '';
  const inflight = new Set();
  const startTime = Date.now();
  const counts = () => `Claimed ${claimed} | Owned ${ownedCount} | Skipped ${skippedOdd} | ` +
                       `Failed ${failCount}`;
  const perMin = () =>
    (runStart && claimed ? Math.round(claimed / ((Date.now() - runStart) / 60000)) : 0);

  say('info', 'START', `Fab Asset Claimer BLAZE ${VERSION} | ${scopeLabel} | browser: ${browserName}`);
  say('info', 'START', `Speed preset: ${PRESET} (${speed.conc} at once, ${speed.gap} ms between ` +
      `requests) | items handled before: ${done.size} | claims allowed: ${CFG.MAX_PER_RUN}`);
  console.log('%c GUIDE %c green = all good   %c YELLOW %c small issue, the script keeps going   ' +
              '%c RED %c serious problem, the script has stopped',
              LOOK.ok[0], '', LOOK.warn[0], '', LOOK.err[0], '');
  say('info', 'NOTE', 'Do NOT refresh, close or leave this page while the script runs. ' +
      'BLAZE slows itself down automatically if Fab pushes back.');
  if (browserName.startsWith('Other')) {
    say('warn', 'WARN', 'Untested browser. Chrome, Brave and Firefox (desktop) are supported.');
  }

  const ticker = setInterval(() => {                    // live status box
    const now = Date.now();
    maybeSpeedUp();
    if (now < pauseUntil) {
      setBox(`Fab asked to slow down - cooling down, ${clock(pauseUntil - now)} left`, 'warn');
    } else if (phase === 'run') {
      setBox(`BLAZING: ${perMin()} claims/min | ${active} at once (max ${speed.conc})`);
    }
  }, 1000);

  async function handle(item, state) {
    const r = await claim(item, state);
    if (r.owned) {
      ownedCount++; consecFails = 0; consecSkips = 0;
      done.add(item.uid); save(DONE_KEY, done);
      addRow(item.title, item.uid, 'Already owned', r.note);
      say('info', 'OWNED', `Already in your library - skipped: ${item.title}`);
    } else if (r.ok) {
      claimed++; consecFails = 0; consecSkips = 0;
      done.add(item.uid); save(DONE_KEY, done);
      addRow(item.title, item.uid, 'Claimed', r.note);
      say('ok', 'OK', `#${claimed} Claimed: ${item.title}`);
      if (claimed % 25 === 0) {
        say('info', 'SPEED', `${claimed} claimed so far - ${perMin()} claims/min, ` +
            `${speed.conc} at once, ${speed.gap} ms between requests.`);
      }
      if (claimed >= CFG.MAX_PER_RUN) capReached = true;
    } else if (r.skip) {
      skippedOdd++; consecSkips++; consecFails = 0;
      failed.add(item.uid); save(FAIL_KEY, failed);
      addRow(item.title, item.uid, 'Skipped', r.why);
      say('warn', 'SKIP', `${item.title} - ${r.why}. Probably owned already or not claimable; ` +
          'skipping it.');
      if (consecSkips >= CFG.MAX_CONSEC_SKIPS) {
        throw new Fatal(`${CFG.MAX_CONSEC_SKIPS} items in a row could not be claimed. ` +
          'Something is wrong (login, terms or a Fab change). See Troubleshooting in the PDF.');
      }
    } else {
      failCount++; consecFails++;
      failed.add(item.uid); save(FAIL_KEY, failed);
      addRow(item.title, item.uid, 'Failed', r.why);
      say('warn', 'FAIL', `${item.title} - ${r.why}. Skipping this item and continuing.`);
      if (consecFails >= CFG.MAX_CONSEC_FAILS) {
        throw new Fatal(`${CFG.MAX_CONSEC_FAILS} items failed in a row. ` +
                        'Stopping to be safe - see Troubleshooting in the PDF.');
      }
    }
  }

  async function runPool(items, states) {
    let idx = 0;
    const worker = async (id) => {
      while (!window.stopClaim && !fatal && !capReached) {
        if (idx >= items.length) return;
        if (id >= speed.conc) { await sleep(400); continue; }   // slowed down: this worker rests
        const item = items[idx++];
        if (inflight.has(item.uid) || done.has(item.uid)) continue;
        inflight.add(item.uid); active++;
        try { await handle(item, states ? states.get(item.uid) : null); }
        catch (e) { fatal = fatal || e; }
        finally { active--; inflight.delete(item.uid); }
      }
    };
    await Promise.all(Array.from({ length: CFG.CONCURRENCY }, (_, i) => worker(i)));
    if (fatal) throw fatal;
  }

  try {
    say('info', 'STEP 1/4', 'Finding the right search for this page...');
    let source = 'the page\'s own search request';
    let base = fromPageRequest();
    if (!base) {
      if (!sellerName && !catSlug) {
        throw new Fatal('Unsupported page. Open a Fab seller or category page with ?is_free=1.');
      }
      source = 'the page address (backup method)';
      base = builtFromUrl();
    }
    base.set('is_free', '1');   // never touch paid items
    const sig = [...base.entries()].map(([k, v]) => `${k}=${v}`).sort().join('&');
    const CURSOR_KEY = CURSOR_PREFIX + sig;
    let cursor = localStorage.getItem(CURSOR_KEY) || null;
    say('info', 'INFO', `Search built from ${source}: ?${base.toString()}`);
    if (cursor) say('info', 'INFO', 'Resuming from the page position saved last time.');

    let firstPage = true;
    while (!window.stopClaim && !capReached) {
      if (firstPage) say('info', 'STEP 2/4', 'Loading the first page of items...');
      const qs = new URLSearchParams(base);
      if (cursor) qs.set('cursor', cursor);
      const sRes = await call(`search?${qs}`);
      if (!sRes.ok) {
        if (cursor) {
          say('warn', 'WARN', 'The saved page position was rejected by Fab. ' +
              'Starting again from page 1 (items already handled are skipped).');
          cursor = null;
          localStorage.removeItem(CURSOR_KEY);
          continue;
        }
        throw new Fatal(`Fab did not return the item list (HTTP ${sRes.status}). ` +
                        'Refresh the page, check you are logged in, and try again later.');
      }
      const page = await sRes.json();
      const results = page.results || [];
      say('info', 'PAGE', `Loaded ${results.length} items.`);
      if (!results.length) {
        endReason = 'No more items in this list';
        say('ok', 'DONE', 'No more items in this list - nothing left to claim here.');
        break;
      }

      if (firstPage) {
        firstPage = false;
        say('info', 'STEP 3/4', 'Verifying that you are logged in to Fab...');
        const login = await verifyLogin(results[0].uid);
        if (login === 'no') throw new Fatal(`You are not logged in to Fab. ${LOGIN_HELP}`);
        if (login === 'yes') say('ok', 'OK', 'Login verified - Fab accepted your session.');
        else say('warn', 'WARN', 'Could not verify your Fab login automatically. Make sure you ' +
                 'are logged in. The script continues and stops by itself if Fab rejects it.');
        say('info', 'STEP 4/4', 'Preview check - compare these names with the page you have open:');
        say('info', 'CHECK', 'First items: ' + results.slice(0, 3).map((r) => r.title).join(' | '));
        if (CFG.START_DELAY > 0) {
          say('info', 'CHECK', `Blazing starts in ${secs(CFG.START_DELAY)} s. ` +
              'If the names do NOT match, type  stopClaim = true  now.');
          await sleepShow(CFG.START_DELAY, (left) =>
            `Preview check - blazing starts in ${Math.ceil(left / 1000)} s`);
        }
        if (window.stopClaim) break;
        runStart = Date.now();
        phase = 'run';
      }

      // Layer 1: items this script already handled. Layer 2: Fab's own ownership data.
      const fresh = [];
      for (const item of results) {
        if (done.has(item.uid) || failed.has(item.uid)) skippedCache++;
        else fresh.push(item);
      }
      const states = fresh.length ? await fetchStates(fresh.map((r) => r.uid)) : null;

      // Layers 3-5 (details flag, server reply, "not claimable") run inside claim().
      await runPool(fresh, states);
      if (capReached) {
        endReason = `Session cap of ${CFG.MAX_PER_RUN} claims reached`;
        say('ok', 'DONE', `Session cap of ${CFG.MAX_PER_RUN} claims reached - this is normal. ` +
            'Run the script again to continue.');
        break;
      }
      if (window.stopClaim) break;

      const next = page.cursors && page.cursors.next;
      if (!next || next === cursor) {
        endReason = 'Reached the last page of this list';
        say('ok', 'DONE', 'Reached the last page of this list.');
        localStorage.removeItem(CURSOR_KEY);
        break;
      }
      cursor = next;
      localStorage.setItem(CURSOR_KEY, cursor);
      await sleep(rand(CFG.PAGE_DELAY));
    }
    if (!endReason && window.stopClaim) {
      endReason = 'Stopped by user';
      say('ok', 'STOPPED', 'You stopped the script. Everything done so far is saved.');
    }
  } catch (e) {
    const byUser = e instanceof Fatal && /Stopped by user/.test(e.message);
    hadError = !byUser;
    endReason = e instanceof Fatal ? e.message : `Error: ${e && e.message ? e.message : e}`;
    if (byUser) say('ok', 'STOPPED', 'You stopped the script. Everything done so far is saved.');
    else if (e instanceof Fatal) say('err', 'STOP', e.message);
    else { say('err', 'ERROR', `Unexpected problem: ${endReason}`); console.error(e); }
  }

  // ---------- wrap up ----------
  clearInterval(ticker);
  window.stopClaim = true;                               // make sure no worker keeps running
  window.removeEventListener('beforeunload', guard);
  session.endedAt = new Date().toISOString();
  session.endReason = endReason || 'Finished';
  session.saved = downloadReport(session);
  persist();

  const endKind = hadError ? 'err' : (failCount > 0 || skippedOdd > 0) ? 'warn' : 'ok';
  closeBox(`Report saved to Downloads\n${counts()}`, endKind);
  say(endKind, 'END', `Session over (${mins(Date.now() - startTime)} min, ` +
      `${perMin()} claims/min). ` +
      `Claimed: ${claimed} | Already owned: ${ownedCount} | Skipped (cached): ${skippedCache} | ` +
      `Skipped (not claimable): ${skippedOdd} | Failed: ${failCount} | ` +
      `Total handled so far: ${done.size}`);
  const nextStep = hadError
    ? 'Read the red message above, fix the cause, then run the script again. ' +
      'See "Common Bugs & Troubleshooting" in the PDF.'
    : /cap/i.test(endReason) ? 'Run the script again later to continue where it stopped.'
    : /last page|No more/i.test(endReason)
      ? 'This list is finished. Open another supported page to continue.'
    : 'Run the script again any time - it resumes where it stopped.';
  say('info', 'NEXT', nextStep);
})();
