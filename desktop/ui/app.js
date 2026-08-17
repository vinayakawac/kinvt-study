/*
 * Kinvt-study — quiz window controller.
 *
 * The window is created hidden and stays alive for the life of the app, so
 * this script is also where the interval timer lives: a hidden webview keeps
 * running its JS, which means Rust does not need to know the user's interval
 * setting or duplicate any scheduling.
 *
 * Timer discipline is the same as the extension's: ONE setTimeout at a time,
 * re-armed after each fire. No polling, no setInterval, nothing running
 * between popups.
 */
(function () {
  'use strict';

  var TAURI = window.__TAURI__ || {
    core: { invoke: function () { return Promise.resolve(); } },
    event: { emit: function () {}, listen: function () {} }
  };
  var invoke = TAURI.core.invoke;
  var listen = TAURI.event.listen;

  var cardEl = document.getElementById('card');
  var timer = null;
  var open = false;
  var lastH = 0;

  function hide() {
    open = false;
    lastH = 0;
    cardEl.innerHTML = '';
    invoke('hide_quiz');
    scheduleNext(); // resume the countdown to the next automatic popup
  }

  // A transparent window shows its unused area as a floating rectangle, so
  // the window has to track the card's real height rather than guess it.
  function fitWindow() {
    // Measure the wrapper, not the card, so the padding that keeps the
    // rounded corners off the window edge is included.
    var h = Math.ceil(cardEl.getBoundingClientRect().height);
    if (h > 0 && h !== lastH) {
      lastH = h;
      invoke('resize_quiz', { height: h });
    }
  }

  // Calling fitWindow() at hand-picked moments measured the card before the
  // browser had laid out the new content — so revealing the feedback panel
  // grew the card but not the window, and the Next button ended up below the
  // window's bottom edge with no way to scroll to it. An observer fires after
  // layout, every time, without having to predict which actions resize things.
  var cardObserver = new ResizeObserver(function () { fitWindow(); });
  cardObserver.observe(cardEl);

  /* ---------- showing a quiz ----------
   * `manual` marks an explicit request — the hotkey or the tray. Those always
   * fire: silently swallowing a keypress reads as a bug, and pressing the key
   * IS the statement that now is a fine moment.
   */
  function startQuiz(manual) {
    if (open) return; // never stack two cards in one window

    if (!manual) {
      var s = window.KinvtQuiz.getSettings();
      if (Date.now() < window.KinvtQuiz.getSnoozeUntil()) { scheduleNext(); return; }
      if (window.KinvtQuietHours.isQuietAt(new Date(), s)) { scheduleNext(); return; }

      if (s.respectDnd !== false) {
        return invoke('dnd_active').then(function (busy) {
          // Skipped, not queued. Queuing would fire a burst of cards the
          // moment a game closes, which is worse than missing one.
          if (busy) { scheduleNext(); return; }
          return present();
        }).catch(function () { return present(); });
      }
    }
    return present();
  }

  function present(prebuilt) {
    return Promise.resolve(prebuilt || window.KinvtQuiz.buildQuiz()).then(function (quiz) {
      if (!quiz) return; // nothing selected — stay quiet rather than show an empty card
      open = true;
      cardEl.innerHTML = '';

      window.TPQ_UI.create(cardEl, {
        questions: quiz.questions,
        title: quiz.title,
        durationSec: quiz.durationSec,
        theme: quiz.theme,
        glass: quiz.glass,
        glassCustom: quiz.glassCustom,
        skipSummary: true,   // answer-and-done, no summary screen
        onProgress: fitWindow,   // each question is a different height
        onAnswer: function (question, wasCorrect) {
          window.KinvtQuiz.recordAnswer(question, wasCorrect);
        },
        onFinish: function (correct, total) {
          window.KinvtQuiz.recordResult(correct, total);
          fitWindow();
          // Lightning mode keeps the card alive with a fresh batch instead of
          // closing. Off by default here: a popup that never ends is an
          // interruption, not a study aid.
          if (quiz.lightning && open) {
            window.KinvtQuiz.buildQuiz().then(function (next) {
              if (next && next.questions.length && open) present(next);
            });
          }
        },
        onClose: hide
      });

      invoke('show_quiz');
      // Measure after layout, not during it.
      requestAnimationFrame(fitWindow);
    });
  }

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function scheduleNext() {
    clearTimer();
    var s = window.KinvtQuiz.getSettings();
    if (!s.enabled) return;
    // Floor of 2 minutes matches what Settings allows; anything smaller would
    // be an interruption rather than a study prompt.
    var mins = Math.max(2, Math.round(s.intervalMin) || 30);
    timer = setTimeout(function () {
      startQuiz(false);
    }, mins * 60 * 1000);
  }

  // Tray menu and the global hotkey both route through this event, so there
  // is one code path for "start a quiz now" — and both count as manual.
  listen('start-quiz', function () { startQuiz(true); });

  listen('snooze', function () {
    window.KinvtQuiz.setSnoozeUntil(Date.now() + 60 * 60 * 1000);
    scheduleNext();
  });

  // Settings changes must re-arm the timer, otherwise a new interval would
  // not take effect until after the next popup fired on the old one.
  window.addEventListener('storage', function (e) {
    if (e.key === 'kinvt.settings') scheduleNext();
  });

  // Refresh the question bank in the background. Failure is fine — the
  // bundled banks are what actually get used if this never succeeds.
  window.KinvtQuiz.syncContent();
  setInterval(function () { window.KinvtQuiz.syncContent(); }, 6 * 60 * 60 * 1000);

  scheduleNext();
})();
