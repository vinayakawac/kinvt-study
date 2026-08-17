/*
 * Kinvt-study — the Android app shell.
 *
 * The desktop settings page is one long scroll, which is right for a window
 * you open occasionally and wrong for an app you live in. This turns it into
 * four screens behind a bottom tab bar without rewriting any of it: the
 * existing <section> cards are MOVED into screen containers, so every handler
 * settings.js already attached keeps working on the same elements.
 *
 * Rewriting the settings UI for mobile would have meant two implementations of
 * every control and two places for a bug to live. Reparenting has neither.
 */
(function (global) {
  'use strict';
  if (!global.Capacitor) return;

  var TABS = [
    { id: 'home',     label: 'Home',     icon: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z' },
    { id: 'library',  label: 'Library',  icon: 'M4 5h7v14H4zM13 5h7v14h-7z' },
    { id: 'progress', label: 'Progress', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
    { id: 'settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1 2 2 0 1 1-4 0 1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.6a2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7 2 2 0 1 1 0 4z' }
  ];

  function svg(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="' + path + '"/></svg>';
  }

  // Sections are identified by their heading rather than by position, so
  // adding a card to settings.html cannot silently shuffle everything.
  function sectionByHeading(text) {
    var heads = document.querySelectorAll('section.card .sec-head h2');
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].textContent.trim().toLowerCase() === text) return heads[i].closest('section.card');
    }
    return null;
  }

  function build() {
    var body = document.body;
    var header = document.querySelector('header.top');
    var startBtn = document.getElementById('startNow');
    var footer = document.querySelector('footer');

    var appearance = sectionByHeading('appearance');
    var library = sectionByHeading('library');
    var progress = sectionByHeading('progress');
    var devices = sectionByHeading('devices');
    // The popup/schedule card is the only one with no heading.
    var schedule = null;
    var cards = document.querySelectorAll('section.card');
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].querySelector('.sec-head h2')) { schedule = cards[i]; break; }
    }

    var shell = document.createElement('div');
    shell.id = 'kq-app';
    shell.innerHTML =
      '<div class="kq-screens">' +
        '<section class="kq-screen" data-screen="home"></section>' +
        '<section class="kq-screen" data-screen="library" hidden></section>' +
        '<section class="kq-screen" data-screen="progress" hidden></section>' +
        '<section class="kq-screen" data-screen="settings" hidden></section>' +
      '</div>' +
      '<nav class="kq-tabs">' + TABS.map(function (t) {
        return '<button type="button" class="kq-tab" data-tab="' + t.id + '">' +
          svg(t.icon) + '<span>' + t.label + '</span></button>';
      }).join('') + '</nav>';
    body.appendChild(shell);

    var screen = function (id) { return shell.querySelector('[data-screen="' + id + '"]'); };

    // ---- Home: what you came to do, and how you are doing ----
    var home = screen('home');
    home.innerHTML =
      '<div class="kq-hero">' +
        '<h1>Kinvt-study</h1>' +
        '<p class="kq-sub">Local quiz · no accounts · works offline</p>' +
        '<div class="kq-figures">' +
          '<div><b id="kqAnswered">0</b><span>answered</span></div>' +
          '<div><b id="kqAcc">–</b><span>accuracy</span></div>' +
          '<div><b id="kqReview">0</b><span>to review</span></div>' +
        '</div>' +
        '<p class="kq-weak" id="kqWeak"></p>' +
      '</div>';
    if (header) home.insertBefore(header, home.firstChild);
    if (startBtn) home.appendChild(startBtn);

    if (library) screen('library').appendChild(library);
    if (progress) screen('progress').appendChild(progress);
    [schedule, appearance, devices].forEach(function (s) { if (s) screen('settings').appendChild(s); });
    if (footer) screen('settings').appendChild(footer);

    // ---- tab switching ----
    // One scroller serves all four screens, so switching tabs would otherwise
    // carry the scroll position across — coming back to a long Library from
    // Home would land wherever Home happened to be. Android keeps a position
    // per tab, so the position is parked on the way out and restored on the
    // way in.
    var scroller = shell.querySelector('.kq-screens');
    var parked = {};
    var current = null;

    function show(id) {
      if (current) parked[current] = scroller.scrollTop;
      TABS.forEach(function (t) {
        screen(t.id).hidden = (t.id !== id);
        shell.querySelector('[data-tab="' + t.id + '"]').classList.toggle('active', t.id === id);
      });
      current = id;
      scroller.scrollTop = parked[id] || 0;
      if (id === 'home' || id === 'progress') refreshHome();
    }

    shell.querySelector('.kq-tabs').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tab]');
      if (!btn) return;
      var id = btn.getAttribute('data-tab');
      if (id === current) {
        // Tapping the tab you are already on scrolls that screen back to the
        // top, which is what the gesture means everywhere else on the phone.
        scroller.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (global.KinvtHaptic) global.KinvtHaptic();
      show(id);
    });
    show('home');

    // ---- home figures ----
    function refreshHome() {
      var t = global.KinvtMerge.totals(global.KinvtProgress.getStats());
      document.getElementById('kqAnswered').textContent = t.answered;
      document.getElementById('kqAcc').textContent = t.answered
        ? Math.round((t.correct / t.answered) * 100) + '%' : '–';
      document.getElementById('kqReview').textContent = global.KinvtProgress.reviewCount();

      // Naming the weakest topic is the one piece of advice the data supports.
      var rows = global.KinvtProgress.topicBreakdown().filter(function (r) { return r.accuracy !== null; });
      var el = document.getElementById('kqWeak');
      el.textContent = rows.length
        ? 'Weakest so far: ' + (global.KinvtTopicLabels && global.KinvtTopicLabels[rows[0].id] || rows[0].id) +
          ' at ' + Math.round(rows[0].accuracy * 100) + '%'
        : 'Answer a few questions and your weakest topic will show up here.';
    }
    global.addEventListener('storage', function (e) {
      if (e.key === 'kinvt.stats') refreshHome();
    });
    global.KinvtNav = { show: show, refresh: refreshHome };
    refreshHome();
  }

  document.addEventListener('DOMContentLoaded', function () {
    // settings.js renders the library asynchronously; build after it so the
    // sections exist to be moved.
    setTimeout(build, 0);
  });
})(typeof window !== 'undefined' ? window : globalThis);
