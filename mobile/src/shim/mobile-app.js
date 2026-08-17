/*
 * Kinvt-study — the Android quiz screen.
 *
 * The desktop card is a small frameless window that floats over other work and
 * measures itself so the transparent window shows no empty space. None of that
 * applies on a phone, where the app IS the screen.
 *
 * The phone's home screen is the settings page — topics, progress, controls —
 * and a quiz opens over it in a full-screen overlay. Shipping the desktop's
 * index.html instead gave a blank screen, because that page is a transparent
 * window whose body is an empty card until a popup fires.
 *
 * What is shared is the part that matters: the same TPQ_UI card, the same
 * banks, the same recording of answers and review queue.
 */
(function (global) {
  'use strict';
  if (!global.Capacitor) return;

  var OVERLAY_ID = 'kinvt-quiz-overlay';

  function overlay() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.hidden = true;
    el.innerHTML = '<div class="kq-scroll"><div id="card"></div></div>';
    document.body.appendChild(el);
    return el;
  }

  function close() {
    running = false;            // stop lightning mode chaining another batch
    var el = document.getElementById(OVERLAY_ID);
    if (!el) return;
    el.hidden = true;
    var card = document.getElementById('card');
    if (card) card.innerHTML = '';
    document.body.style.overflow = '';
    // The storage event does not fire in the document that wrote it, so the
    // home figures would sit at their old values until a tab switch.
    if (global.KinvtNav) global.KinvtNav.refresh();
  }

  // Lightning mode: when a batch runs out, the next one is built and rendered
  // immediately, so questions keep coming until you close the card.
  //
  // On a phone this is the default. A desktop popup interrupts you and should
  // end quickly; an app you deliberately opened should not stop after three
  // questions and make you tap again.
  var running = false;

  function renderBatch(quiz, lightning) {
    var card = document.getElementById('card');
    card.innerHTML = '';
    global.TPQ_UI.create(card, {
      questions: quiz.questions,
      title: quiz.title,
      durationSec: 0,              // no auto-close: a phone is not a popup
      theme: quiz.theme,
      glass: quiz.glass,
      glassCustom: quiz.glassCustom,
      // A summary between every batch would be exactly the break lightning
      // mode exists to remove.
      skipSummary: lightning,
      onAnswer: function (q, ok) { global.KinvtQuiz.recordAnswer(q, ok); },
      onFinish: function (c, t) {
        global.KinvtQuiz.recordResult(c, t);
        if (!lightning || !running) return;
        // Build the next batch before the card tears itself down, so the
        // stream never visibly stops.
        global.KinvtQuiz.buildQuiz().then(function (next) {
          if (!running) return;
          if (next && next.questions.length) renderBatch(next, true);
          else close();
        });
      },
      onClose: close
    });
  }

  function startQuiz() {
    // Storage hydrates asynchronously on Android, so a quiz opened from a cold
    // start — a notification tap, or the app launching — must wait. Otherwise
    // it builds from an empty cache and ignores every setting and past answer.
    return global.KinvtStorage.ready()
      .then(function () { return global.KinvtQuiz.buildQuiz(); })
      .then(function (quiz) {
        if (!quiz) {
          global.alert('No topics selected — choose at least one in the Library tab.');
          return;
        }
        var s = global.KinvtQuiz.getSettings();
        var lightning = s.lightning === true;

        var el = overlay();
        el.hidden = false;
        document.body.style.overflow = 'hidden';   // stop the page behind scrolling
        running = true;
        renderBatch(quiz, lightning);
      })
      .catch(function (e) {
        global.alert('Could not start a quiz: ' + (e && e.message ? e.message : e));
      });
  }

  // Lightning is the right default on a phone and the wrong one on the
  // desktop, where the card is an interruption. DEFAULT_SETTINGS carries the
  // desktop value, so the phone flips it once on first run — guarded by its
  // own key so a later "off" from the user is never overwritten.
  function applyMobileDefaults() {
    try {
      if (localStorage.getItem("kinvt.mobileDefaults")) return;
      var s = global.KinvtQuiz.getSettings();
      s.lightning = true;
      global.KinvtQuiz.setSettings(s);
      localStorage.setItem("kinvt.mobileDefaults", "1");
    } catch (e) { /* storage unavailable; the desktop default stands */ }
  }

  global.KinvtMobile = { startQuiz: startQuiz, close: close };

  document.addEventListener('DOMContentLoaded', function () {
    // "Quiz me now" emits a Tauri event on the desktop, which the quiz window
    // listens for. There is no second window here, so it is wired directly.
    var btn = document.getElementById('startNow');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        startQuiz();
      }, true);
    }

    global.KinvtStorage.ready()
      .then(applyMobileDefaults)
      .then(function () { return global.KinvtReminders ? global.KinvtReminders.init() : null; })
      .then(function () { return global.KinvtQuiz.syncContent(); })
      .catch(function () { /* offline: the bundled banks are what get used */ });
  });

  // The hardware back button should close the quiz rather than exit the app.
  if (global.Capacitor.Plugins && global.Capacitor.Plugins.App) {
    global.Capacitor.Plugins.App.addListener('backButton', function (info) {
      var el = document.getElementById(OVERLAY_ID);
      if (el && !el.hidden) { close(); return; }
      if (!info || !info.canGoBack) global.Capacitor.Plugins.App.exitApp();
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
