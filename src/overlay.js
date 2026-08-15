/*
 * Kinvt-study — overlay content script (overlay.js)
 * ---------------------------------------------------------------
 * Injected into the user's active tab by background.js (ui-core.js is
 * injected first and defines window.TPQ_UI in this isolated world).
 *
 * This file only *defines* window.__tpqShowQuiz(payload). background.js
 * then calls it with the quiz passed directly as an executeScript `args`
 * value. It deliberately does NOT fetch its own payload: the previous
 * design asked the service worker for it and fell back to reading
 * chrome.storage.session, and both links are unreliable from a content
 * script — storage.session is closed to content scripts in Chrome MV3
 * unless setAccessLevel() opens it, and the message round-trip races the
 * worker waking up. Passing the payload in as an argument removes the
 * whole handshake, so there is nothing left to time out or be denied.
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
  var api = (typeof browser !== 'undefined' && browser) ? browser : chrome;

  function send(type, data) {
    try {
      Promise.resolve(api.runtime.sendMessage(Object.assign({ type: type }, data || {})))
        .catch(function () { /* background may be asleep; nothing to do */ });
    } catch (e) { /* noop */ }
  }

  // Returns a short string on refusal so background.js can tell "the page
  // said no" apart from "injection itself failed", instead of both looking
  // like a silent no-op.
  window.__tpqShowQuiz = function (payload) {
    var existing = document.getElementById(HOST_ID);
    if (existing) {
      // A stale card from a previous quiz would otherwise block every later
      // one forever. Replace it rather than bailing out.
      if (existing.parentNode) existing.parentNode.removeChild(existing);
    }

    if (document.fullscreenElement || document.webkitFullscreenElement) return 'fullscreen';
    if (globalThis.innerWidth < 340 || globalThis.innerHeight < 380) return 'viewport-too-small';
    if (typeof window.TPQ_UI !== 'object' || !window.TPQ_UI.create) return 'ui-core-missing';
    if (!payload || !Array.isArray(payload.questions) || !payload.questions.length) return 'no-questions';

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
      return 'no-shadow-dom';
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
      // Resume point, so the card can be rebuilt on another tab without
      // throwing away the user's place in the quiz.
      startIndex: payload.startIndex || 0,
      startScore: payload.startScore || 0,
      onProgress: function (idx, score) {
        send('QUIZ_PROGRESS', { idx: idx, score: score });
      },
      onFinish: function (correct, total) {
        send('QUIZ_RESULT', { correct: correct, total: total });
      },
      onClose: function () {
        send('QUIZ_CLOSED');
        if (host.parentNode) host.parentNode.removeChild(host);
      }
    });

    return 'shown';
  };
})();
