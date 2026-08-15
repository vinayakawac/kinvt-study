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

  var invoke = window.__TAURI__.core.invoke;
  var listen = window.__TAURI__.event.listen;

  var cardEl = document.getElementById('card');
  var timer = null;
  var open = false;

  function hide() {
    open = false;
    lastH = 0;
    cardEl.innerHTML = '';
    invoke('hide_quiz');
    scheduleNext(); // resume the countdown to the next automatic popup
  }

  // A transparent window shows its unused area as a floating rectangle, so
  // the window has to track the card's real height rather than guess it.
  var lastH = 0;

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

  function startQuiz() {
    if (open) return; // never stack two cards in one window
    return window.KinvtQuiz.buildQuiz().then(function (quiz) {
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
        onFinish: function (correct, total) {
          window.KinvtQuiz.recordResult(correct, total);
          fitWindow();
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
    var mins = Math.max(1, Math.round(s.intervalMin) || 30);
    timer = setTimeout(function () {
      startQuiz();
    }, mins * 60 * 1000);
  }

  // Tray menu and the global hotkey both route through this event, so there
  // is one code path for "start a quiz now".
  listen('start-quiz', function () { startQuiz(); });

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
