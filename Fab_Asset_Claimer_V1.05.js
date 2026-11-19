/* =========================================================================
 * Fab Asset Claimer  V1.05
 * Creator : Shailesh R. Narnaware
 * Purpose : Patiently adds FREE assets on Fab.com to your library. Works on
 *           seller pages (e.g. Quixel Megascans) and on free-category pages.
 * Browsers: Chrome, Brave, Firefox (desktop). Paste into the DevTools Console
 *           while a supported Fab page is open and you are logged in to Fab.
 * Colors  : GREEN = all good | BLUE = information | YELLOW = small issue,
 *           the script keeps going | RED = serious problem, script stopped.
 * WARNING : Do NOT refresh, close or leave the page while the script runs.
 * Report  : A CSV report of every session is saved to your Downloads folder.
 * ========================================================================= */
(async () => {
  const VERSION = 'V1.05';

  // ---------------- SETTINGS (all times in milliseconds) ----------------
  const CFG = {
    CLAIM_DELAY: [6000, 12000],     // pause between claims (6-12 s)
    PAGE_DELAY: [8000, 15000],      // pause between catalog pages (8-15 s)
    BATCH_SIZE: 25,                 // claims before a long rest
    BATCH_REST: [180000, 360000],   // long rest (3-6 min)
    MAX_PER_RUN: 300,               // max claims per session
    START_DELAY: 10000,             // grace time before the first claim (abort window)
    BACKOFF_START: 120000,          // first wait after a 429 reply (2 min)
    BACKOFF_MAX: 1800000,           // longest wait after repeated 429s (30 min)
    MAX_THROTTLE_HITS: 5,           // abort after this many 429s in a row
    MAX_CONSEC_FAILS: 5,            // abort after this many failed items in a row
    STATE_CHUNK: 6                  // items per "already owned?" check request
  };
  // ----------------------------------------------------------------------

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
  const DONE_KEY = 'srn_fab_done_v8';       // shared by all pages (items are global)
  const FAIL_KEY = 'srn_fab_failed_v8';
  const CURSOR_PREFIX = 'srn_fab_cursor_v102:';
  const SESSION_KEY = 'srn_fab_session_v103';
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

  // Sleeps while showing a live countdown in the status box, e.g. "Resting, 3:20 left"
  const clock = (ms) => `${Math.floor(ms / 60000)}:${pad(Math.floor((ms % 60000) / 1000))}`;
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
    out.push(line(['Tool', `Fab Asset Claimer ${VERSION}`]));
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
      a.download = `Fab_Asset_Claimer_Session_${stamp(s.start)}${suffix}.csv`;
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

  // If an earlier session was cut off (page closed/refreshed), save its report now
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

  // ---------- on-page status box (a visible reminder; border color = status) ----------
  const BOX_COL = { ok: '#00D9A0', info: '#00D9A0', warn: '#F5C518', err: '#DC2626' };
  let box = null, boxLine = null;
  function makeBox() {
    try {
      const old = document.getElementById('fac-box');
      if (old) old.remove();
      box = document.createElement('div');
      box.id = 'fac-box';
      Object.assign(box.style, {
        position: 'fixed', left: '16px', bottom: '16px', zIndex: '2147483647', width: '330px',
        background: '#0B1220', color: '#E6EDF7', border: '2px solid #00D9A0',
        borderRadius: '8px', padding: '10px 12px', font: '12px/1.45 Arial, sans-serif',
        boxShadow: '0 6px 20px rgba(0,0,0,.55)'
      });
      const t = document.createElement('div');
      t.textContent = `Fab Asset Claimer ${VERSION} - RUNNING`;
      t.style.fontWeight = 'bold'; t.style.color = '#00D9A0';
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
      box.firstChild.textContent = `Fab Asset Claimer ${VERSION} - ${titles[kind]}`;
      box.firstChild.style.color = BOX_COL[kind];
      box.style.borderColor = BOX_COL[kind];
      boxLine.textContent = msg;
      box.children[2].textContent = 'You may refresh the page now.';
      box.children[2].style.color = '#8EA0BF';
      box.children[3].remove();
    } catch (e) { /* ignore */ }
  };

  // ---------- polite request wrapper ----------
  async function callAbs(url, opts = {}) {
    let backoff = CFG.BACKOFF_START;
    for (let hits = 0; hits < CFG.MAX_THROTTLE_HITS; hits++) {
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
        const ra = Number(res.headers.get('retry-after')) * 1000 || 0;
        const wait = Math.max(ra, backoff) * (1 + Math.random() * 0.2);
        say('warn', 'WAIT', `Fab says "too many requests" (${hits + 1}/${CFG.MAX_THROTTLE_HITS}). ` +
            `Cooling down for ${mins(wait)} min, then continuing automatically. Nothing to do.`);
        await sleepShow(wait, (left) =>
          `Fab asked to slow down - cooling down, ${clock(left)} left`, 'warn');
        backoff = Math.min(backoff * 2, CFG.BACKOFF_MAX);
        continue;
      }
      return res;
    }
    throw new Fatal('Fab keeps answering "too many requests". Stopping to protect your account. ' +
                    'Wait several hours (or until tomorrow) before running again.');
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

  // Best source: the exact search request the Fab page itself already made
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

  // Backup: build the search query from the page address
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

  // ---------- ownership hints (skips items you already own) ----------
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
  let loggedSearchFields = false, loggedDetailFields = false, loggedStateFields = false;
  const seenOwnedKeys = new Set();
  const noteOwned = (key) => {
    if (!seenOwnedKeys.has(key)) {
      seenOwnedKeys.add(key);
      say('info', 'INFO', `Fab marks owned items with the field "${key}" - those are skipped.`);
    }
  };

  // Optional shortcut: ask in small groups which items you already own.
  // If Fab refuses even once, the shortcut is switched off and the script carries on.
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
          say('warn', 'SKIP', `The optional "already owned?" shortcut is not available ` +
              `(HTTP ${r.status}). Continuing without it - nothing to fix. A red line from the ` +
              'browser above this message is harmless.');
          return map.size ? map : null;
        }
      } catch (e) {
        if (e instanceof Fatal) throw e;
        statesOn = false;
        say('warn', 'SKIP', 'The optional "already owned?" shortcut failed. Continuing without it.');
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

  async function claim(listItem, state) {
    if (!loggedSearchFields) {
      loggedSearchFields = true;
      say('info', 'INFO', 'Ownership-like fields in search data: ' +
          (ownershipFields(listItem).join(' | ').slice(0, 300) || '(none)'));
    }
    const f0 = ownedFlag(state) || ownedFlag(listItem);
    if (f0) {
      noteOwned(f0);
      return { ok: true, owned: true, noRequest: true, note: `flag ${f0}` };
    }

    const dRes = await call(listItem.uid);              // 1) item details -> real offerId
    if (!dRes.ok) return { ok: false, why: `could not read item details (HTTP ${dRes.status})` };
    const detail = await dRes.json();
    if (!loggedDetailFields) {
      loggedDetailFields = true;
      say('info', 'INFO', 'Ownership-like fields in detail data: ' +
          (ownershipFields(detail).join(' | ').slice(0, 300) || '(none)'));
    }
    const f2 = ownedFlag(detail);
    if (f2) { noteOwned(f2); return { ok: true, owned: true, note: `flag ${f2}` }; }

    const licenses = detail.licenses || [];
    if (!licenses.length) return { ok: false, why: 'Fab lists no licence for this item' };
    const ordered = [...licenses].sort((a, b) =>
      (looksFree(b) - looksFree(a)) ||
      ((b.slug === 'professional') - (a.slug === 'professional'))).slice(0, 3);
    await sleep(rand([800, 2000]));                     // small human-like pause

    let lastWhy = '';
    for (const lic of ordered) {                        // 2) add to library
      if (!lic.offerId) continue;
      const fd = new FormData();
      fd.append('offer_id', lic.offerId);
      const cRes = await call(`${listItem.uid}/add-to-library`, { method: 'POST', body: fd });
      if (cRes.ok) return { ok: true, note: `license ${lic.slug || '?'}` };
      const txt = await cRes.text();
      lastWhy = `Fab refused (HTTP ${cRes.status}) ${txt.slice(0, 120)}`;
      if (/already|owned|exist/i.test(txt) || cRes.status === 409) {
        return { ok: true, owned: true, note: 'server said already owned' };
      }
    }
    return { ok: false, why: lastWhy || 'no usable offer for this item' };
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

  let claimed = 0, ownedCount = 0, skipped = 0, failCount = 0, consecFails = 0, sinceRest = 0;
  let hadError = false;
  const startTime = Date.now();
  const counts = () => `Claimed ${claimed} | Owned ${ownedCount} | Failed ${failCount}`;
  let endReason = '';

  say('info', 'START', `Fab Asset Claimer ${VERSION} | ${scopeLabel} | browser: ${browserName}`);
  say('info', 'START', `Items this script handled before: ${done.size} | ` +
      `claims allowed this session: ${CFG.MAX_PER_RUN}`);
  console.log('%c GUIDE %c green = all good   %c YELLOW %c small issue, the script keeps going   ' +
              '%c RED %c serious problem, the script has stopped',
              LOOK.ok[0], '', LOOK.warn[0], '', LOOK.err[0], '');
  say('info', 'NOTE', 'Do NOT refresh, close or leave this page while the script runs. ' +
      'Pauses of several seconds between items are intentional (they keep your account safe).');
  if (browserName.startsWith('Other')) {
    say('warn', 'WARN', 'Untested browser. Chrome, Brave and Firefox (desktop) are supported.');
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
    outer:
    while (!window.stopClaim) {
      if (firstPage) say('info', 'STEP 2/4', 'Loading the first page of items...');
      const qs = new URLSearchParams(base);
      if (cursor) qs.set('cursor', cursor);
      const sRes = await call(`search?${qs}`);
      if (!sRes.ok) {
        if (cursor) {
          say('warn', 'WARN', 'The saved page position was rejected by Fab. ' +
              'Starting again from page 1 (items already claimed are skipped).');
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
        say('info', 'CHECK', `Starting in ${secs(CFG.START_DELAY)} s. ` +
            'If the names do NOT match, type  stopClaim = true  now.');
        await sleepShow(CFG.START_DELAY, (left) =>
          `Preview check - starting in ${Math.ceil(left / 1000)} s`);
        if (window.stopClaim) break;
      }

      const states = await fetchStates(results.map((r) => r.uid));

      for (const item of results) {
        if (window.stopClaim) break outer;
        if (done.has(item.uid) || failed.has(item.uid)) { skipped++; continue; }

        if (claimed >= CFG.MAX_PER_RUN) {
          endReason = `Session cap of ${CFG.MAX_PER_RUN} claims reached`;
          say('ok', 'DONE', `Session cap of ${CFG.MAX_PER_RUN} claims reached - this is normal. ` +
              'Run the script again later to continue.');
          break outer;
        }

        say('info', 'WORK', `Claiming: ${item.title}`);
        setBox(`Working on: ${String(item.title).slice(0, 45)}`);
        const r = await claim(item, states ? states.get(item.uid) : null);
        if (r.ok && r.owned) {
          ownedCount++; consecFails = 0;
          done.add(item.uid);
          save(DONE_KEY, done);
          addRow(item.title, item.uid, 'Already owned', r.note);
          say('info', 'OWNED', `Already in your library - skipped: ${item.title}`);
          if (!r.noRequest) await sleep(rand([2000, 4000]));
          continue;
        }
        if (r.ok) {
          claimed++; sinceRest++; consecFails = 0;
          done.add(item.uid);
          save(DONE_KEY, done);
          addRow(item.title, item.uid, 'Claimed', r.note);
          say('ok', 'OK', `#${claimed} Claimed: ${item.title}`);
        } else {
          failCount++; consecFails++;
          failed.add(item.uid);
          save(FAIL_KEY, failed);
          addRow(item.title, item.uid, 'Failed', r.why);
          say('warn', 'FAIL', `${item.title} - ${r.why}. Skipping this item and continuing.`);
          setBox('One item failed - continuing', 'warn');
          if (consecFails >= CFG.MAX_CONSEC_FAILS) {
            throw new Fatal(`${CFG.MAX_CONSEC_FAILS} items failed in a row. ` +
                            'Stopping to be safe - see Troubleshooting in the PDF.');
          }
        }

        if (sinceRest >= CFG.BATCH_SIZE) {
          const rest = rand(CFG.BATCH_REST);
          say('info', 'REST', `Batch of ${CFG.BATCH_SIZE} done. Resting ${mins(rest)} min ` +
              '(planned break, keep the page open)...');
          await sleepShow(rest, (left) =>
            `Resting, ${clock(left)} left (planned break - do not refresh)`);
          sinceRest = 0;
        } else {
          await sleepShow(rand(CFG.CLAIM_DELAY), (left) =>
            `Next item in ${Math.ceil(left / 1000)} s`);
        }
      }

      const next = page.cursors && page.cursors.next;
      if (!next || next === cursor) {
        endReason = 'Reached the last page of this list';
        say('ok', 'DONE', 'Reached the last page of this list.');
        localStorage.removeItem(CURSOR_KEY);
        break;
      }
      cursor = next;
      localStorage.setItem(CURSOR_KEY, cursor);
      const gap = rand(CFG.PAGE_DELAY);
      say('info', 'PAGE', `Next page of items in ${secs(gap)} s...`);
      await sleepShow(gap, (left) => `Loading the next page in ${Math.ceil(left / 1000)} s`);
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

  // ---------- wrap up: save the session report ----------
  window.removeEventListener('beforeunload', guard);
  session.endedAt = new Date().toISOString();
  session.endReason = endReason || 'Finished';
  session.saved = downloadReport(session);
  persist();

  const endKind = hadError ? 'err' : failCount > 0 ? 'warn' : 'ok';
  closeBox(`Report saved to Downloads\n${counts()}`, endKind);
  say(endKind, 'END', `Session over (${mins(Date.now() - startTime)} min). ` +
      `Claimed: ${claimed} | Already owned: ${ownedCount} | Skipped (cached): ${skipped} | ` +
      `Failed: ${failCount} | Total handled so far: ${done.size}`);
  const next = hadError ? 'Read the red message above, fix the cause, then run the script again. ' +
                          'See "Common Bugs & Troubleshooting" in the PDF.'
    : /cap/i.test(endReason) ? 'Run the script again later (for example tomorrow) to continue.'
    : /last page|No more/i.test(endReason)
      ? 'This list is finished. Open another supported page to continue.'
    : 'Run the script again any time - it resumes where it stopped.';
  say('info', 'NEXT', next);
})();
