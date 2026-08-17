/*
 * Kinvt-study — the Android quiz screen.
 *
 * The desktop card is a small frameless window that floats over other work and
 * measures itself so the transparent window shows no empty space. None of that
 * applies on a phone, where the app IS the screen: no measuring, no resizing,
 * no always-on-top.
 *
 * What is shared is the part that matters — the same TPQ_UI card, the same
 * question banks, the same recording of answers, the same review queue.
 */
(function (global) {
  'use strict';
  if (!global.Capacitor) return;

  function host() {
    var el = document.getElementById('card');
    if (!el) {
      el = document.createElement('div');
      el.id = 'card';
      document.body.appendChild(el);
    }
    return el;
  }

  function startQuiz() {
    // Storage hydrates asynchronously on Android, so a quiz opened from a
    // notification tap on a cold start must wait — otherwise it would build
    // itself from an empty cache and ignore every setting and every past
    // answer.
    return global.KinvtStorage.ready()
      .then(function () { return global.KinvtQuiz.buildQuiz(); })
      .then(function (quiz) {
        if (!quiz) return;
        var el = host();
        el.innerHTML = '';
        global.TPQ_UI.create(el, {
          questions: quiz.questions,
          title: quiz.title,
          durationSec: 0,          // no auto-close: a phone is not a popup
          theme: quiz.theme,
          glass: quiz.glass,
          glassCustom: quiz.glassCustom,
          skipSummary: false,      // on a phone the summary is worth showing
          onAnswer: function (q, ok) { global.KinvtQuiz.recordAnswer(q, ok); },
          onFinish: function (c, t) { global.KinvtQuiz.recordResult(c, t); },
          onClose: function () { el.innerHTML = ''; }
        });
      });
  }

  global.KinvtMobile = { startQuiz: startQuiz };

  document.addEventListener('DOMContentLoaded', function () {
    global.KinvtStorage.ready()
      .then(function () { return global.KinvtReminders ? global.KinvtReminders.init() : null; })
      .then(function () { return global.KinvtQuiz.syncContent(); })
      .catch(function () { /* offline: the bundled banks are what get used */ });
  });
})(typeof window !== 'undefined' ? window : globalThis);
