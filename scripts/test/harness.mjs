// Loads desktop/ui modules so their logic can be tested.
//
// The UI modules are IIFEs that attach to a `global` rather than ES modules,
// because the webview loads them with plain <script> tags and has no build
// step. They cannot be imported, so they are compiled as functions taking a
// fake `window` and called with one.
//
// Deliberately NOT vm.createContext: a vm context is a separate realm, so
// every object the modules return carries that realm's Object.prototype and
// assert.deepStrictEqual rejects it against an identical-looking literal from
// this realm. Running them here keeps one realm and one Object.
import fs from 'node:fs';
import path from 'node:path';

const UI_DIR = path.join(process.cwd(), 'desktop', 'ui');

export function makeLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, String(v)]));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    _dump: () => Object.fromEntries(store)
  };
}

export function loadModules(files, { localStorage = makeLocalStorage(), fetchImpl } = {}) {
  const win = {
    localStorage,
    console,
    crypto: globalThis.crypto,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
    fetch: fetchImpl || globalThis.fetch,
    setTimeout,
    clearTimeout,
    // The UI listens for cross-window storage events; harmless no-ops here.
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  win.window = win;

  // Shadow as function parameters every global the UI touches by bare name.
  // `window` alone is not enough: the modules call `fetch(...)` directly, and
  // without shadowing that resolves to Node's real fetch, which would try to
  // load "library.json" as a URL instead of using the stub.
  const shadowed = ['window', 'self', 'fetch', 'localStorage', 'crypto', 'btoa', 'atob', 'setTimeout', 'clearTimeout'];
  const values = [win, win, win.fetch, win.localStorage, win.crypto, win.btoa, win.atob, win.setTimeout, win.clearTimeout];

  for (const f of files) {
    const src = fs.readFileSync(path.join(UI_DIR, f), 'utf8');
    // eslint-disable-next-line no-new-func
    const fn = new Function(...shadowed, src + '\n//# sourceURL=' + f);
    fn(...values);
  }
  return win;
}

// The module set almost every test needs, in dependency order.
export const CORE = ['merge.js', 'storage.js', 'progress.js', 'selection.js', 'quiz-engine.js'];
