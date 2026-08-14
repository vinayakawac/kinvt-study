/*
 * Kinvt-study — overlay content script (overlay.js)
 * ---------------------------------------------------------------
 * Injected into the user's active tab by background.js (ui-core.js is
 * injected first and defines window.TPQ_UI in this isolated world).
 *
 * - Renders the quiz inside a shadow root → the page's CSS cannot break
 *   the card, and ours cannot leak into the page.
 * - The card is genuinely translucent: rgba glass + backdrop-filter blur
 *   over whatever the user is browsing.
 * - Work is O(questions) once, then a single timeout + two listeners.
 *   Zero timers/loops after close (the host element is removed).
 * - Politely bails out when the page is in fullscreen or the viewport
 *   is too small to show a card.
 */
(function () {
  'use strict';

  var HOST_ID = '__tpq_overlay_host__';

  function send(type, data) {
    try {
      Promise.resolve(api.runtime.sendMessage(Object.assign({ type: type }, data || {})))
        .catch(function () { /* background may be asleep; nothing to do */ });
    } catch (e) { /* noop */ }
  }

  if (document.getElementById(HOST_ID)) return; // already showing

  // Don't disturb fullscreen video/presentations or tiny viewports.
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  if (globalThis.innerWidth < 340 || globalThis.innerHeight < 380) return;

  var api = (typeof browser !== 'undefined' && browser) ? browser : chrome;
  if (!api || !api.runtime || !api.runtime.id) return; // not an extension context

  if (typeof window.TPQ_UI !== 'object' || !window.TPQ_UI.create) return;

  /* ---- fetch the payload queued by background.js ---- */
  function getPayload() {
    return new Promise(function (resolve) {
      var settled = false;
      // A truthy payload always wins and settles immediately. A falsy/failed
      // result must NOT settle — otherwise it locks out the storage fallback
      // below, which exists precisely for when the primary path comes back
      // empty (e.g. "receiving end does not exist" while the worker wakes).
      var done = function (v) { if (!settled && v) { settled = true; resolve(v); } };
      var giveUp = function () { if (!settled) { settled = true; resolve(null); } };

      // Primary: ask the (just-woke, still-alive) service worker.
      Promise.resolve(api.runtime.sendMessage({ type: 'GET_PENDING_QUIZ' }))
        .then(function (res) { done(res && res.pendingQuiz); })
        .catch(function () { /* fall through to the storage fallback below */ });

      // Fallback: storage.session snapshot (in case the worker went away).
      setTimeout(function () {
        Promise.resolve(api.storage.session.get('pendingQuiz'))
          .then(function (got) { done(got && got.pendingQuiz); })
          .catch(function () { /* fall through to the final give-up timeout */ });
      }, 400);

      setTimeout(giveUp, 2500); // give up quietly
    });
  }

  getPayload().then(function (payload) {
    if (!payload || !Array.isArray(payload.questions) || !payload.questions.length) return;

    var host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText =
      'position:fixed;z-index:2147483647;right:16px;bottom:16px;' +
      'width:min(400px,calc(100vw - 32px));' +
      'pointer-events:none;'; // only the card itself is interactive
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-label', 'Quiz popup');

    var shadow;
    try {
      shadow = host.attachShadow({ mode: 'open' });
    } catch (e) {
      return; // shadow DOM unavailable — bail out
    }

    var wrap = document.createElement('div');
    wrap.style.cssText = 'pointer-events:auto;';
    shadow.appendChild(wrap);

    (document.body || document.documentElement).appendChild(host);

    window.TPQ_UI.create(wrap, {
      questions: payload.questions,
      title: payload.title || 'Quiz',
      durationSec: payload.durationSec || 45,
      theme: payload.theme || 'dark',
      glass: payload.glass || 'balanced',
      glassCustom: payload.glassCustom || 70,
      onFinish: function (correct, total) {
        send('QUIZ_RESULT', { correct: correct, total: total });
      },
      onClose: function () {
        send('QUIZ_CLOSED');
        if (host.parentNode) host.parentNode.removeChild(host);
      }
    });
  });
})();
