// Shared Playwright helpers for harness/learn-check.mjs and every harness/learn/<module>.check.mjs (LEARN.md D24, §11;
// Learn integrator). Re-exports the Phase A helpers (harness/tools/helpers.mjs: VIEWPORTS, newPage, settle, frameCost,
// frameCostChecks, axe, readOverlayPixel, drag, wheelBurst, pinch …) and adds the Learn page's URL, waits and the
// init scripts LI-4 / LI-5 need (network guard, storage-key recorder) plus IndexedDB readers.
//
// Functions handed to page.addInitScript / page.evaluate are serialised: they must not close over anything here.
export * from '../tools/helpers.mjs';

/** `http://127.0.0.1:<port>/client/dist/learn.html?label=learn-check` plus `query` (string or record) and `hash`. */
export function learnUrl(port, query = {}, hash = '') {
  const q = new URLSearchParams(typeof query === 'string' ? query : { label: 'learn-check', ...query });
  return `http://127.0.0.1:${port}/client/dist/learn.html?${q.toString()}${hash ? (hash.startsWith('#') ? hash : `#${hash}`) : ''}`;
}

/** The research shell's URL on the same server (LI-4 seeds a research annotation there). */
export function researchUrl(port, query = {}) {
  const q = new URLSearchParams({ label: 'learn-check', ...query });
  return `http://127.0.0.1:${port}/client/dist/shell.html?${q.toString()}`;
}

/** Wait until the Learn page finished booting (window.__learn.ready): modules installed, the course (or plate) up. */
export async function waitForLearn(page, timeout = 60_000) {
  await page.waitForFunction(() => window.__learn?.ready === true && window.__shell !== undefined, null, { timeout, polling: 100 });
}

/** Wait until view A has a slide whose engine base level is resident (window.__stage0, as in the shell). */
export async function waitForSlide(page, timeout = 60_000) {
  await page.waitForFunction(() => window.__stage0?.state().baseLoaded === true && window.__shell?.host().slide !== null, null, { timeout, polling: 100 });
}

/** The catalogue ids the Learn content uses (data/catalogue.json). */
export const TUMOR_014 = 'camelyon16.tumor_014.r36864_66560';
export const CMU_SMALL = 'openslide.CMU-1-Small-Region';

/** ux-copy §3 strings (verbatim). */
export const LEARN_LABEL = 'For educational use. Not a medical device. Contains no protected health information.';
export const LEARN_BADGE_ARIA = 'Stoipath Learn. For educational use. Not a medical device. Contains no protected health information. Open About';
export const RUO_PRODUCT = 'Stoipath Viewer (RUO)';
export const RUO_LABEL = 'For Research Use Only';
export const CSP = "connect-src 'self'; form-action 'none'; base-uri 'self'";

/**
 * Init script (LI-5): records every attempt to send data out of the page: navigator.sendBeacon, new WebSocket, fetch
 * or XMLHttpRequest with a body or a method other than GET / HEAD, EventSource. The calls still run (the CSP is what
 * blocks them); `window.__netGuard.attempts` lists them.
 */
export const NET_GUARD = () => {
  const G = (window.__netGuard = { attempts: [] });
  const note = (kind, detail) => G.attempts.push({ kind, detail: String(detail).slice(0, 200) });
  const nb = navigator.sendBeacon?.bind(navigator);
  if (nb) navigator.sendBeacon = (url, data) => (note('sendBeacon', url), nb(url, data));
  const NativeWS = window.WebSocket;
  if (NativeWS) {
    window.WebSocket = class extends NativeWS {
      constructor(...a) {
        note('WebSocket', a[0]);
        super(...a);
      }
    };
  }
  const NativeES = window.EventSource;
  if (NativeES) {
    window.EventSource = class extends NativeES {
      constructor(...a) {
        note('EventSource', a[0]);
        super(...a);
      }
    };
  }
  const f = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (init?.body != null || (method !== 'GET' && method !== 'HEAD')) note('fetch', `${method} ${input instanceof Request ? input.url : input}`);
    return f(input, init);
  };
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__m = String(method).toUpperCase();
    this.__u = url;
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (body != null || (this.__m !== 'GET' && this.__m !== 'HEAD')) note('xhr', `${this.__m} ${this.__u}`);
    return send.call(this, body);
  };
};

/** Init script (LI-4): records the keys written to localStorage and sessionStorage (`window.__storageWrites`). */
export const STORAGE_RECORDER = () => {
  const W = (window.__storageWrites = { local: [], session: [] });
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    (this === window.localStorage ? W.local : W.session).push(String(k));
    return set.call(this, k, v);
  };
};

/** Every request of a page (url, method, same origin), recorded from page.on('request'), workers included. */
export function recordRequests(page, origin) {
  const list = [];
  page.on('request', (r) => {
    const url = r.url();
    let same = false;
    try {
      same = new URL(url).origin === origin;
    } catch {
      same = url.startsWith('data:') || url.startsWith('blob:');
    }
    if (url.startsWith('data:') || url.startsWith('blob:')) same = true;
    list.push({ url, method: r.method(), same });
  });
  return list;
}

/** All keys and values of one object store (read in the page with raw IndexedDB; never through the shell). */
export async function idbDump(page, dbName, storeName) {
  return page.evaluate(
    ([db, store]) =>
      new Promise((done) => {
        const req = indexedDB.open(db);
        req.onerror = () => done({ error: String(req.error) });
        req.onsuccess = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(store)) {
            d.close();
            done({ entries: [], missingStore: true });
            return;
          }
          const tx = d.transaction(store, 'readonly');
          const os = tx.objectStore(store);
          const keys = os.getAllKeys();
          const vals = os.getAll();
          tx.oncomplete = () => {
            d.close();
            done({ entries: keys.result.map((k, i) => [String(k), JSON.stringify(vals.result[i])]) });
          };
          tx.onerror = () => {
            d.close();
            done({ error: String(tx.error) });
          };
        };
      }),
    [dbName, storeName],
  );
}

/** indexedDB.databases() names. */
export async function idbNames(page) {
  return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort());
}

/** Every DOM string a user or AT can meet: text, title, alt, placeholder, aria-* (LI-3 / LI-10 scans). */
export async function domStrings(page) {
  return page.evaluate(() => {
    const out = [document.title];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
      const p = n.parentElement;
      if (p !== null && (p.closest('template, script, style') !== null)) continue;
      const t = (n.textContent ?? '').trim();
      if (t !== '') out.push(t);
    }
    for (const el of document.querySelectorAll('*')) {
      for (const a of el.getAttributeNames()) if (a === 'title' || a === 'alt' || a === 'placeholder' || a.startsWith('aria-')) out.push(el.getAttribute(a) ?? '');
    }
    return out;
  });
}
