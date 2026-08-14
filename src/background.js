/*
 * Kinvt-study — background service worker
 * ---------------------------------------------------------------
 * Low-CPU design:
 *  - Scheduling uses chrome/browser.alarms → the service worker sleeps
 *    between events (Chrome terminates it). ZERO background activity
 *    while idle — no setInterval, no polling, no network, no AI.
 *  - Work happens only inside event handlers (install / startup / alarm /
 *    message / storage change), then the worker goes back to sleep.
 *
 * Cross-browser: `browser` (Firefox) is preferred when present,
 * otherwise `chrome` (Chrome/Edge). Both support promises here.
 */
'use strict';

const api = (typeof browser !== 'undefined' && browser) ? browser : chrome;

const ALARM_NAME = 'tpq-popup';
const WELCOME_ALARM = 'tpq-welcome';
const SYNC_ALARM = 'tpq-content-sync';
const SYNC_PERIOD_MINUTES = 24 * 60; // once a day, no user interaction needed
const PENDING_KEY = 'pendingQuiz';   // storage.session: quiz payload awaiting a UI
const SHOWING_KEY = 'quizShowing';   // storage.session: timestamp of a quiz currently on screen
const SHOWING_TTL_MS = 5 * 60 * 1000;

// Public, free content repo the library also syncs from in the background —
// no server to run, no cost, and the extension needs no runtime permission
// prompt for it since <all_urls> is already granted for overlay injection.
const REMOTE_LIBRARY_BASE = 'https://raw.githubusercontent.com/vinayakawac/kinvt-study/main/';

// Default settings — keep in sync with sidepanel.js
const DEFAULT_SETTINGS = {
  enabled: true,
  intervalMin: 30,        // minutes between auto popups
  perQuiz: 3,             // questions per popup
  durationSec: 45,        // auto-close after N seconds of inactivity
  theme: 'dark',          // 'dark' | 'light' | 'auto'
  glass: 'balanced',      // 'clear' | 'balanced' | 'frosted' | 'custom'
  glassCustom: 70,        // custom glass intensity (35–92)
  topics: {               // library topics — default ON for the core four
    'general-knowledge': true,
    'upsc': true,
    'kpsc': true,
    'current-affairs': true,
    'ssc': false,
    'banking': false,
    'railways': false,
    'defence': false,
    'constitution-polity': false,
    'indian-history': false,
    'geography': false,
    'economy': false,
    'science-tech': false,
    'environment': false,
    'sports': false,
    'karnataka-gk': false
  }
};

const DEFAULT_STATS = { answered: 0, correct: 0, streak: 0 };

/* ---------- tiny utilities ---------- */

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

async function getSettings() {
  const got = await api.storage.local.get({ settings: DEFAULT_SETTINGS });
  const s = got.settings || {};
  // Migration: early builds stored selections under `categories`; v1 uses `topics`.
  const topics = s.topics || s.categories;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    topics: { ...DEFAULT_SETTINGS.topics, ...(topics || {}) }
  };
}

/* ---------- alarm scheduling ---------- */

async function ensureAlarm() {
  const settings = await getSettings();
  const existing = await api.alarms.get(ALARM_NAME);
  if (settings.enabled) {
    // Chrome enforces a 1-minute minimum period — clamp defensively.
    const minutes = Math.max(1, Math.round(settings.intervalMin) || 30);
    if (!existing) {
      api.alarms.create(ALARM_NAME, { periodInMinutes: minutes });
    }
  } else if (existing) {
    api.alarms.clear(ALARM_NAME);
  }
}

/* ---------- background content sync (no user interaction) ----------
 * Once a day, pull each library topic's JSON from the public kinvt-study
 * GitHub repo and merge it into the bundled bank by question `id`
 * (same id updates that question, new id adds one). If a fetch ever fails
 * (offline, repo unreachable), the bundled JSON shipped with the extension
 * is always used as-is — the library never ends up empty.
 */

async function ensureContentSyncAlarm() {
  const existing = await api.alarms.get(SYNC_ALARM);
  if (!existing) api.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
}

async function fetchRemoteTopic(cat) {
  try {
    const res = await fetch(REMOTE_LIBRARY_BASE + cat.file + '?cb=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.questions) ? data.questions : null;
  } catch (e) {
    return null; // offline or repo unreachable — bundled JSON stays the source of truth
  }
}

async function syncContent() {
  let catalog;
  try {
    catalog = await (await fetch(api.runtime.getURL('library.json'))).json();
  } catch (e) {
    return;
  }

  const got = await api.storage.local.get({ remoteLibrary: {} });
  const remoteLibrary = got.remoteLibrary || {};
  let updatedAny = false;

  for (const cat of catalog) {
    const questions = await fetchRemoteTopic(cat);
    if (questions) {
      remoteLibrary[cat.id] = { questions, updatedAt: Date.now() };
      updatedAny = true;
    }
  }

  if (updatedAny) {
    await api.storage.local.set({ remoteLibrary, lastSyncAt: Date.now() });
  }
}

function mergeById(bundled, remote) {
  if (!remote || !remote.length) return bundled;
  const merged = new Map(bundled.map(q => [q.id, q]));
  remote.forEach(q => merged.set(q.id, q));
  return Array.from(merged.values());
}

/* ---------- quiz builder (local JSON + daily-synced overrides, no AI) ---------- */

async function buildQuiz() {
  const settings = await getSettings();
  if (!settings.enabled) return null;

  const activeIds = Object.keys(settings.topics).filter(k => settings.topics[k]);
  if (!activeIds.length) return null;

  let catalog;
  try {
    catalog = await (await fetch(api.runtime.getURL('library.json'))).json();
  } catch (e) {
    return null;
  }

  const remoteLibrary = (await api.storage.local.get({ remoteLibrary: {} })).remoteLibrary || {};

  const bank = [];
  const labels = [];
  for (const cat of catalog) {
    if (!activeIds.includes(cat.id)) continue;
    try {
      const data = await (await fetch(api.runtime.getURL(cat.file))).json();
      const questions = mergeById(data.questions || [], remoteLibrary[cat.id] && remoteLibrary[cat.id].questions);
      for (const q of questions) bank.push(q);
      labels.push(cat.label);
    } catch (e) { /* skip a broken bank file rather than fail the whole quiz */ }
  }
  if (!bank.length) return null;

  shuffle(bank);
  const perQuiz = Math.max(1, Math.min(Math.round(settings.perQuiz) || 3, bank.length));

  // Keep the header compact even when many topics are selected.
  const titleText = labels.length <= 2
    ? labels.join(' · ')
    : labels.slice(0, 2).join(' · ') + ' +' + (labels.length - 2) + ' more';

  return {
    questions: bank.slice(0, perQuiz),
    title: titleText,
    durationSec: Math.round(settings.durationSec) || 45,
    theme: settings.theme || 'dark',
    glass: settings.glass || 'balanced',
    glassCustom: settings.glassCustom | 0 || 70,
    ts: Date.now()
  };
}

/* ---------- finding a real browser tab to inject into ---------- */

async function getActiveContentTab() {
  // `lastFocusedWindow: true` can resolve to a non-content window instead of
  // the actual browser window with tabs — some browsers/forks implement a
  // sidebar as its own top-level window, so a click from inside it can make
  // "last focused window" mean the sidebar itself (no matching http/https
  // tab there), silently sending every quiz to the popup-window fallback
  // instead of the intended in-page overlay. Explicitly asking for a
  // 'normal' window sidesteps that.
  try {
    const win = await api.windows.getLastFocused({ windowTypes: ['normal'] });
    if (win && win.id != null) {
      const tabs = await api.tabs.query({ active: true, windowId: win.id });
      if (tabs && tabs[0]) return tabs[0];
    }
  } catch (e) { /* fall through to the broader query below */ }

  try {
    const tabs = await api.tabs.query({ active: true, windowType: 'normal' });
    return (tabs && tabs[0]) || null;
  } catch (e) { /* tabs.query needs no extra permission; ignore failures */ }

  return null;
}

/* ---------- showing the quiz ---------- */

async function showQuiz(force) {
  // One quiz at a time for the *auto* popup: if one was shown recently, don't
  // stack another. A manual "Quiz me now" click is an explicit user action —
  // it always goes through, even if a previous auto/manual quiz never sent
  // back QUIZ_CLOSED/QUIZ_RESULT (e.g. injection silently no-op'd on a tiny
  // viewport). Without `force`, that stale guard could make every subsequent
  // click do nothing for up to SHOWING_TTL_MS with no visible feedback.
  if (!force) {
    const cur = await api.storage.session.get(SHOWING_KEY);
    if (cur && cur[SHOWING_KEY] && Date.now() - cur[SHOWING_KEY] < SHOWING_TTL_MS) return;
  }

  const quiz = await buildQuiz();
  if (!quiz) return;

  await api.storage.session.set({ [PENDING_KEY]: quiz, [SHOWING_KEY]: Date.now() });

  // Preferred path: translucent overlay injected into the focused tab.
  const tab = await getActiveContentTab();

  if (tab && tab.id != null && typeof tab.url === 'string' && /^(https?|file):/i.test(tab.url)) {
    try {
      await api.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['ui-core.js', 'overlay.js']
      });
      return;
    } catch (e) {
      // Restricted page (chrome://, store pages, …) or injection failure.
      // Fall through to the dedicated window below.
    }
  }

  // Fallback path: small standalone popup window (works everywhere).
  try {
    await api.windows.create({
      url: api.runtime.getURL('quiz-window.html'),
      type: 'popup',
      width: 420,
      height: 660,
      focused: true
    });
  } catch (e) { /* give up quietly */ }
}

/* ---------- toolbar click: open the settings sidecar ---------- */

async function openSidecar(tab) {
  // 1) Chrome / Edge: the side panel (chrome.sidePanel, Chrome 114+).
  if (api.sidePanel && typeof api.sidePanel.open === 'function') {
    try {
      const winId = (tab && tab.windowId) ? tab.windowId : undefined;
      await api.sidePanel.open(winId ? { windowId: winId } : {});
      return;
    } catch (e) { /* fall through */ }
  }

  // 2) Firefox: the sidebar (browser.sidebarAction, requires user gesture —
  //    satisfied because this runs inside an action-click handler).
  if (api.sidebarAction && typeof api.sidebarAction.toggle === 'function') {
    try {
      await api.sidebarAction.toggle();
      return;
    } catch (e) { /* fall through */ }
  }

  // 3) Fallback: a small window with the same settings panel.
  try {
    await api.windows.create({
      url: api.runtime.getURL('sidepanel.html?windowed=1'),
      type: 'popup',
      width: 480,
      height: 720,
      focused: true
    });
  } catch (e) { /* give up quietly */ }
}

if (api.action && api.action.onClicked) {
  api.action.onClicked.addListener((tab) => { openSidecar(tab); });
}

/* ---------- lifecycle wiring ---------- */

api.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  ensureContentSyncAlarm();
  syncContent(); // first sync right away, doesn't block anything
  // Friendly first taste: one popup a minute after install.
  api.alarms.create(WELCOME_ALARM, { delayInMinutes: 1 });
});

api.runtime.onStartup.addListener(() => {
  ensureAlarm();
  ensureContentSyncAlarm();
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME || alarm.name === WELCOME_ALARM) {
    showQuiz();
  } else if (alarm.name === SYNC_ALARM) {
    syncContent();
  }
});

// Re-schedule if settings changed outside the popup (e.g. sync or future UI).
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) ensureAlarm();
});

/* ---------- message router ---------- */

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handle = async () => {
    if (!msg || typeof msg.type !== 'string') return { ok: false };

    switch (msg.type) {

      case 'SETTINGS_CHANGED':
        await ensureAlarm();
        return { ok: true };

      case 'BUILD_QUIZ': {          // "Quiz me now" from the settings sidecar — rendered inline in the
        const quiz = await buildQuiz();  // sidecar itself, so this has no side effects: no tab injection,
        return { quiz };                 // no popup window, no "don't stack" guard to get stuck on.
      }

      case 'GET_PENDING_QUIZ': {    // overlay / window asks for its payload
        const got = await api.storage.session.get(PENDING_KEY);
        const quiz = got && got[PENDING_KEY] ? got[PENDING_KEY] : null;
        if (quiz) await api.storage.session.remove(PENDING_KEY); // consume once
        return { pendingQuiz: quiz };
      }

      case 'QUIZ_RESULT': {         // user finished the quiz
        const got = await api.storage.local.get({ stats: DEFAULT_STATS });
        const stats = { ...DEFAULT_STATS, ...(got.stats || {}) };
        const total = Math.max(0, msg.total | 0);
        const correct = Math.max(0, msg.correct | 0);
        stats.answered += total;
        stats.correct += correct;
        stats.streak = (total > 0 && correct === total) ? stats.streak + 1 : 0;
        await api.storage.local.set({ stats });
        await api.storage.session.remove(SHOWING_KEY);
        return { ok: true };
      }

      case 'QUIZ_CLOSED':           // user dismissed the quiz early
        await api.storage.session.remove(SHOWING_KEY);
        return { ok: true };

      default:
        return { ok: false };
    }
  };

  handle()
    .then(res => { try { sendResponse(res); } catch (e) { /* channel gone */ } })
    .catch(err => { try { sendResponse({ ok: false, error: String(err) }); } catch (e) { /* channel gone */ } });

  return true; // keep the message channel open for the async response
});
