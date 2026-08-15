/*
 * Kinvt-study — fallback quiz window (quiz-window.js)
 * ---------------------------------------------------------------
 * Extension page shown in a small dedicated popup window when the
 * overlay cannot be injected (chrome:// pages, stores, blocked tabs).
 * Same quiz card UI via window.TPQ_UI; closes the window when done.
 */
(function () {
  'use strict';

  var api = (typeof browser !== 'undefined' && browser) ? browser : chrome;

  var card = document.getElementById('card');
  // The window has no chrome of its own any more — the card's own × closes
  // it via onClose below. This stays tolerant in case the markup changes.
  var closeBtn = document.getElementById('closeWin');

  function send(type, data) {
    try {
      Promise.resolve(api.runtime.sendMessage(Object.assign({ type: type }, data || {})))
        .catch(function () { /* noop */ });
    } catch (e) { /* noop */ }
  }

  function getPayload() {
    return new Promise(function (resolve) {
      var settled = false;
      // A truthy payload always wins and settles immediately. A falsy/failed
      // result must NOT settle — otherwise it locks out the storage fallback
      // below, which exists precisely for when the primary path comes back
      // empty (e.g. "receiving end does not exist" while the worker wakes).
      var done = function (v) { if (!settled && v) { settled = true; resolve(v); } };
      var giveUp = function () { if (!settled) { settled = true; resolve(null); } };

      Promise.resolve(api.runtime.sendMessage({ type: 'GET_PENDING_QUIZ' }))
        .then(function (res) { done(res && res.pendingQuiz); })
        .catch(function () { /* fall through to the storage fallback below */ });

      setTimeout(function () {
        Promise.resolve(api.storage.session.get('pendingQuiz'))
          .then(function (got) { done(got && got.pendingQuiz); })
          .catch(function () { /* fall through to the final give-up timeout */ });
      }, 400);

      setTimeout(giveUp, 2500);
    });
  }

  function showEmpty() {
    card.innerHTML =
      '<div class="empty">' +
        '<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>' +
        '<p>No quiz queued right now.</p>' +
        '<p style="opacity:.55;font-size:12.5px">Tap the extension icon in your toolbar and hit <b>Quiz me now</b>.</p>' +
        '<button type="button" id="emptyClose">Close</button>' +
      '</div>';
    document.getElementById('emptyClose').addEventListener('click', function () { window.close(); });
  }

  if (closeBtn) closeBtn.addEventListener('click', function () { window.close(); });

  // background.js reuses this window rather than stacking a new one for each
  // quiz, so an already-open page has to re-read the payload when told to.
  try {
    api.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'QUIZ_WINDOW_RELOAD') location.reload();
    });
  } catch (e) { /* noop */ }

  getPayload().then(function (payload) {
    if (!payload || !Array.isArray(payload.questions) || !payload.questions.length) {
      showEmpty();
      return;
    }
    window.TPQ_UI.create(card, {
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
        window.close();
      }
    });
  });
})();
