// Background service worker (Chrome/Edge) / event page (Firefox).
// Registers top-level listeners only — no persistent timers, no polling.
// In Chrome, core/*.js are not listed in the manifest so they're pulled in
// here via importScripts(). In Firefox, the manifest's "scripts" array
// already loaded them as globals before this file runs, so the guard below
// skips importScripts (which isn't available outside a Worker anyway).
if (typeof self.QuizPop === "undefined" && typeof importScripts === "function") {
  importScripts(
    "../core/browser-api.js",
    "../core/categories.js",
    "../core/storage.js",
    "../core/quiz-engine.js",
    "../core/content-sync.js"
  );
}

const api = self.QuizPop.api;
const storage = self.QuizPop.storage;
const quizEngine = self.QuizPop.quizEngine;
const contentSync = self.QuizPop.contentSync;

const ALARM_NAME = "quiz-popup-alarm";
const SYNC_ALARM_NAME = "quiz-content-sync-alarm";
const SYNC_PERIOD_MINUTES = 24 * 60; // once a day, no user interaction needed
const HOST_PERMISSIONS = { origins: ["http://*/*", "https://*/*"] };

function syncAlarm(settings) {
  return api.alarms.clear(ALARM_NAME).then(() => {
    if (settings.autoPopupEnabled) {
      api.alarms.create(ALARM_NAME, { periodInMinutes: settings.intervalMinutes });
    }
  });
}

function ensureContentSyncAlarm() {
  return api.alarms.get(SYNC_ALARM_NAME).then((existing) => {
    if (!existing) {
      api.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MINUTES });
    }
  });
}

api.runtime.onInstalled.addListener(() => {
  storage.getSettings().then(syncAlarm);
  ensureContentSyncAlarm();
  contentSync.syncAll(); // first sync right away, doesn't block anything
});

api.runtime.onStartup?.addListener(() => {
  storage.getSettings().then(syncAlarm);
  ensureContentSyncAlarm();
});

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "UPDATE_ALARM") {
    storage.getSettings().then(syncAlarm).then(() => sendResponse({ ok: true }));
    return true; // async response
  }
  return false;
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    handleAlarmFire();
  } else if (alarm.name === SYNC_ALARM_NAME) {
    contentSync.syncAll();
  }
});

function handleAlarmFire() {
  api.permissions
    .contains(HOST_PERMISSIONS)
    .then((granted) => {
      if (!granted) return; // user hasn't opted into the overlay permission yet

      return Promise.all([
        api.tabs.query({ active: true, currentWindow: true }),
        storage.getSettings(),
      ]).then(([tabs, settings]) => {
        const tab = tabs[0];
        if (!tab || !tab.id) return;
        if (!settings.selectedCategories.length) return;

        return quizEngine.loadQuestionBank(settings.selectedCategories).then((bank) => {
          const question = quizEngine.pickRandomQuestion(bank);
          if (!question) return;

          return api.scripting
            .executeScript({
              target: { tabId: tab.id },
              func: injectOverlayEntry,
              args: [question],
            })
            .catch(() => {
              // Restricted page (chrome://, store, etc.) — silently skip this cycle.
            });
        });
      });
    })
    .catch(() => {});
}

// Injected verbatim into the page by chrome.scripting.executeScript — must be
// fully self-contained (no closures over outer variables, no imports),
// since executeScript's `func` option requires the function be serializable
// and defined in this file's scope. This is the overlay's entire implementation.
function injectOverlayEntry(question) {
  if (document.getElementById("quizpop-overlay-host")) return; // already showing one

  const host = document.createElement("div");
  host.id = "quizpop-overlay-host";
  host.style.all = "initial";
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .card {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 320px;
      max-width: calc(100vw - 40px);
      padding: 16px;
      border-radius: 14px;
      background: rgba(30, 30, 40, 0.55);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.25);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
      color: #fff;
      font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      z-index: 2147483647;
      transform: translateY(20px);
      opacity: 0;
      transition: transform 0.25s ease, opacity 0.25s ease;
    }
    .card.in { transform: translateY(0); opacity: 1; }
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .title { font-weight: 600; font-size: 12px; letter-spacing: 0.03em; opacity: 0.75; text-transform: uppercase; }
    .close { cursor: pointer; background: none; border: none; color: #fff; opacity: 0.7; padding: 4px; display: flex; align-items: center; justify-content: center; }
    .close:hover { opacity: 1; }
    .question { margin: 0 0 10px; font-size: 14px; }
    .opt { display: block; width: 100%; text-align: left; padding: 8px 10px; margin: 6px 0; border-radius: 8px; border: 1px solid rgba(255,255,255,0.25); background: rgba(255,255,255,0.08); color: #fff; cursor: pointer; font-size: 13px; }
    .opt:hover { background: rgba(255,255,255,0.18); }
    .opt.correct { background: rgba(70, 200, 120, 0.55); border-color: rgba(70, 200, 120, 0.8); }
    .opt.incorrect { background: rgba(220, 80, 80, 0.55); border-color: rgba(220, 80, 80, 0.8); }
    .opt[disabled] { cursor: default; }
    .explain { margin-top: 8px; font-size: 12px; opacity: 0.85; }
  `;
  shadow.appendChild(style);

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="head">
      <span class="title">Quiz Pop</span>
      <button class="close" aria-label="Close"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
    </div>
    <p class="question"></p>
    <div class="opts"></div>
    <div class="explain" style="display:none"></div>
  `;
  shadow.appendChild(card);
  document.body.appendChild(host);
  requestAnimationFrame(() => card.classList.add("in"));

  card.querySelector(".question").textContent = question.question;
  const optsWrap = card.querySelector(".opts");
  const explainEl = card.querySelector(".explain");

  function cleanup() {
    card.classList.remove("in");
    setTimeout(() => host.remove(), 250);
  }

  card.querySelector(".close").addEventListener("click", cleanup);

  let answered = false;
  let dismissTimer = setTimeout(cleanup, 20000);

  question.options.forEach((optText, idx) => {
    const btn = document.createElement("button");
    btn.className = "opt";
    btn.type = "button";
    btn.textContent = optText;
    btn.addEventListener("click", () => {
      if (answered) return;
      answered = true;
      clearTimeout(dismissTimer);
      const isCorrect = idx === question.correctAnswerIndex;
      btn.classList.add(isCorrect ? "correct" : "incorrect");
      if (!isCorrect) {
        const correctBtn = optsWrap.children[question.correctAnswerIndex];
        if (correctBtn) correctBtn.classList.add("correct");
      }
      Array.from(optsWrap.children).forEach((b) => (b.disabled = true));
      if (!isCorrect && question.explanation) {
        explainEl.textContent = question.explanation;
        explainEl.style.display = "block";
      }

      try {
        const api = typeof browser !== "undefined" ? browser : chrome;
        api.storage.local.get("stats").then((res) => {
          const DEFAULT_STATS = { correctCount: 0, incorrectCount: 0, currentStreak: 0, bestStreak: 0, lastAnsweredAt: 0 };
          const stats = { ...DEFAULT_STATS, ...(res.stats || {}) };
          if (isCorrect) {
            stats.correctCount += 1;
            stats.currentStreak += 1;
            stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
          } else {
            stats.incorrectCount += 1;
            stats.currentStreak = 0;
          }
          stats.lastAnsweredAt = Date.now();
          api.storage.local.set({ stats });
        });
      } catch (e) {
        // storage unavailable — non-fatal, overlay still shows feedback
      }

      setTimeout(cleanup, 2500);
    });
    optsWrap.appendChild(btn);
  });
}
