/*
 * Kinvt-study — settings side panel logic (sidepanel.js)
 * Runs inside the Chrome/Edge side panel, the Firefox sidebar, or a
 * windowed fallback (body class "windowed").
 *
 * - Settings are written straight to storage.local; the background worker
 *   picks changes up via storage.onChanged and re-schedules its alarm.
 * - Because the panel stays open while you browse, it also listens to
 *   storage changes and updates the stats live after every quiz.
 */
(function () {
  'use strict';

  var api = (typeof browser !== 'undefined' && browser) ? browser : chrome;

  // The sidecar stays open: don't try to close the window after launching
  // a quiz (only the windowed fallback closes itself).
  var isWindowed = /[?&]windowed=1/.test(location.search);
  if (isWindowed) document.body.classList.add('windowed');

  // Keep in sync with background.js
  var DEFAULT_SETTINGS = {
    enabled: true,
    intervalMin: 30,
    perQuiz: 3,
    durationSec: 45,
    theme: 'dark',
    glass: 'balanced',
    glassCustom: 70,
    topics: {
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
  var DEFAULT_STATS = { answered: 0, correct: 0, streak: 0 };

  var settings = null;
  var flashTimer = null;

  /* ---- glass & transparency (monochrome presets) ---- */
  var GLASS_VALS = {
    clear:    { o: 0.42, blur: 8,  border: 0.14 },
    balanced: { o: 0.72, blur: 16, border: 0.22 },
    frosted:  { o: 0.90, blur: 24, border: 0.28 }
  };
  var GLASS_HINTS = {
    clear:    'Clear — nearly see-through; the page stays fully visible.',
    balanced: 'Balanced — the default; readable over most pages.',
    frosted:  'Frosted — heavy blur and tint; the card almost stands alone.',
    custom:   'Custom — set the glass intensity yourself with the slider.'
  };

  function glassVals() {
    if (settings.glass === 'custom') {
      var p = parseInt(settings.glassCustom, 10) || 70;
      return { o: p / 100, blur: Math.round(6 + p * 0.18), border: 0.12 + (p / 100) * 0.16 };
    }
    return GLASS_VALS[settings.glass] || GLASS_VALS.balanced;
  }

  function renderGlassUI() {
    Array.prototype.slice.call(document.querySelectorAll('#glassSeg button')).forEach(function (b) {
      b.classList.toggle('active', b.dataset.glass === settings.glass);
    });
    $('glassHint').textContent = GLASS_HINTS[settings.glass] || GLASS_HINTS.balanced;
    $('glassCustomRow').hidden = settings.glass !== 'custom';
    $('glassCustom').value = String(settings.glassCustom || 70);
    $('glassCustomVal').textContent = (settings.glassCustom || 70) + '%';
    applyGlassPreview();
  }

  function applyGlassPreview() {
    var v = glassVals();
    var pc = $('gpCard');
    pc.style.setProperty('--gp-o', v.o.toFixed(2));
    pc.style.setProperty('--gp-blur', v.blur + 'px');
    pc.style.setProperty('--gp-border', v.border.toFixed(2));
  }

  // Inline SVG icons for library topics (stroke = currentColor).
  var ICONS = {
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>',
    landmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
    newspaper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>',
    scales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>',
    scroll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8z"/><path d="M4 8a2 2 0 0 1 2-2h3v13H6a2 2 0 0 1-2-2z"/><line x1="11" y1="11" x2="17" y2="11"/><line x1="11" y1="15" x2="17" y2="15"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4l6 2 5-2v14l-5 2-6-2-5 2V6l5-2z"/><line x1="9" y1="4" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="20"/></svg>',
    rupee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/></svg>',
    flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6"/><path d="M10 3v5l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3.5L14 8V3"/><line x1="7.5" y1="15" x2="16.5" y2="15"/></svg>',
    leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>',
    medal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="5"/><path d="m9 9 3-5 3 5"/><path d="M9 9l-3 3"/><path d="M15 9l3 3"/></svg>',
    'map-pin': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    train: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="14" rx="2"/><line x1="4" y1="11" x2="20" y2="11"/><line x1="8" y1="17" x2="8" y2="21"/><line x1="16" y1="17" x2="16" y2="21"/><circle cx="9.5" cy="14" r="0.5"/><circle cx="14.5" cy="14" r="0.5"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/></svg>'
  };

  function $(id) { return document.getElementById(id); }

  function send(type) {
    try {
      Promise.resolve(api.runtime.sendMessage({ type: type })).catch(function () {});
    } catch (e) { /* noop */ }
  }

  function applyTheme(theme) {
    document.body.classList.remove('light');
    if (theme === 'light') document.body.classList.add('light');
    else if (theme === 'auto') {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        document.body.classList.add('light');
      }
    }
  }

  function renderLibrary(catalog) {
    var wrap = $('cats');
    wrap.innerHTML = '';

    var groups = {};
    catalog.forEach(function (cat) {
      var g = cat.group || 'Other';
      (groups[g] = groups[g] || []).push(cat);
    });

    Object.keys(groups).forEach(function (groupName) {
      var h = document.createElement('div');
      h.className = 'group-hdr';
      h.textContent = groupName;
      wrap.appendChild(h);

      groups[groupName].forEach(function (cat) {
        var checked = settings.topics[cat.id] ? 'checked' : '';
        var label = document.createElement('label');
        label.className = 'cat';
        label.innerHTML =
          '<input type="checkbox" data-id="' + cat.id + '" ' + checked + '>' +
          '<span class="box"></span>' +
          '<span class="ico">' + (ICONS[cat.icon] || '') + '</span>' +
          '<span class="txt"><b>' + cat.label + '</b><i>' + cat.blurb + '</i></span>';
        wrap.appendChild(label);
      });
    });

    wrap.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.dataset && t.dataset.id) {
        settings.topics[t.dataset.id] = t.checked;
        save();
      }
    });
  }

  function renderStats(stats) {
    $('stAnswered').textContent = stats.answered;
    $('stCorrect').textContent = stats.correct;
    $('stAcc').textContent = stats.answered ? Math.round((stats.correct / stats.answered) * 100) + '%' : '–';
    $('stStreak').textContent = stats.streak;
  }

  function formatRelativeTime(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
    const days = Math.round(hours / 24);
    return days + ' day' + (days === 1 ? '' : 's') + ' ago';
  }

  function renderSyncStatus() {
    return api.storage.local.get('lastSyncAt').then(function (res) {
      $('syncStatus').textContent = res.lastSyncAt
        ? 'Library last synced ' + formatRelativeTime(res.lastSyncAt) + ' — updates happen automatically in the background.'
        : 'No sync yet — happens automatically in the background shortly.';
    });
  }

  function save() {
    api.storage.local.set({ settings: settings });
    send('SETTINGS_CHANGED'); // re-schedule the alarm
  }

  function allBoxes() {
    return Array.prototype.slice.call(document.querySelectorAll('#cats input'));
  }

  function flashButton(text, ok) {
    var b = $('startNow');
    var span = b.querySelector('span');
    if (flashTimer) clearTimeout(flashTimer);
    span.textContent = text;
    if (ok) b.classList.add('ok');
    flashTimer = setTimeout(function () {
      span.textContent = 'Quiz me now';
      b.classList.remove('ok');
    }, 2200);
  }

  function explainReason(reason) {
    var r = String(reason || '');
    if (r.indexOf('restricted-page:') === 0) {
      return 'Showing here because this browser blocks extensions from drawing on ' +
             r.split(':')[1] + ': pages. Switch to a normal website tab for the on-page popup.';
    }
    if (r === 'no-tab-found') return 'Showing here — no open website tab was found to draw on.';
    if (r === 'fullscreen') return 'Showing here — the page is fullscreen.';
    if (r === 'viewport-too-small') return 'Showing here — that tab is too small to fit the card.';
    if (r.indexOf('inject-failed:') === 0) {
      return 'Showing here — the page could not be drawn on (' + r.slice(14) + ').';
    }
    return 'Showing here — the on-page popup was unavailable (' + (r || 'unknown') + ').';
  }

  function showFallbackReason(reason) {
    var el = $('syncStatus');
    if (!el) return;
    var prev = el.textContent;
    el.textContent = explainReason(reason);
    setTimeout(function () { el.textContent = prev; }, 9000);
  }

  function renderInlineQuiz(quiz) {
    $('settingsView').hidden = true;
    var quizEl = $('inlineQuiz');
    quizEl.hidden = false;
    quizEl.innerHTML = '';

    window.TPQ_UI.create(quizEl, {
      questions: quiz.questions,
      title: quiz.title,
      durationSec: quiz.durationSec,
      theme: settings.theme,
      glass: settings.glass,
      glassCustom: settings.glassCustom,
      onFinish: function (correct, total) {
        Promise.resolve(api.runtime.sendMessage({ type: 'QUIZ_RESULT', correct: correct, total: total }))
          .catch(function () {});
      },
      onClose: function () {
        quizEl.hidden = true;
        quizEl.innerHTML = '';
        $('settingsView').hidden = false;
      }
    });
  }

  // "Quiz me now" prefers showing the translucent card as an overlay on the
  // tab the user is actually browsing — same as the automatic popup.
  // background.js only falls back to returning the quiz payload (instead of
  // injecting it) when there's genuinely no browser tab to inject into (a
  // restricted page, or none open) — in that case, and only then, this
  // renders the card directly into the sidecar's own page. Either way, a
  // real OS popup window is never used for a manual click.
  // Firefox MV3 (Zen included) treats `host_permissions` as opt-in rather
  // than granting them at install, so <all_urls> can be declared-but-not-held
  // — which silently blocks every injection until the user approves it.
  // Chrome grants it at install, so `contains` is already true there and this
  // is a no-op. Must run inside the click handler: `permissions.request()`
  // requires a user gesture, and a "Quiz me now" click is one.
  function ensureHostPermission() {
    var HOST = { origins: ['<all_urls>'] };
    if (!api.permissions || typeof api.permissions.contains !== 'function') {
      return Promise.resolve(true);
    }
    return Promise.resolve(api.permissions.contains(HOST))
      .then(function (granted) {
        if (granted) return true;
        return Promise.resolve(api.permissions.request(HOST)).catch(function () { return false; });
      })
      .catch(function () { return false; });
  }

  function startInlineQuiz() {
    return ensureHostPermission()
      .then(function () { return api.runtime.sendMessage({ type: 'BUILD_QUIZ' }); })
      .catch(function () { return null; })
      .then(function (res) {
        if (!res || !res.quiz) {
          flashButton('No questions selected');
          return;
        }
        if (res.injected) {
          flashButton('Quiz launched — answer it on the page', true);
          return;
        }
        // Falling back to the panel is legitimate, but it should never be
        // silent — otherwise "why isn't it appearing on my page?" has no
        // answer anywhere in the UI. Say why, in plain language.
        showFallbackReason(res.reason);
        renderInlineQuiz(res.quiz);
      });
  }

  function init() {
    Promise.all([
      api.storage.local.get({ settings: DEFAULT_SETTINGS, stats: DEFAULT_STATS }),
      fetch(api.runtime.getURL('library.json')).then(function (r) { return r.json(); })
    ]).then(function (res) {
      var stored = res[0];
      var catalog = res[1];

      var legacy = (stored.settings || {}).categories;
      settings = {
        ...DEFAULT_SETTINGS,
        ...(stored.settings || {}),
        topics: { ...DEFAULT_SETTINGS.topics, ...((stored.settings || {}).topics || legacy || {}) }
      };

      $('enabled').checked = settings.enabled;
      $('interval').value = String(settings.intervalMin);
      $('perQuiz').value = String(settings.perQuiz);
      $('duration').value = String(settings.durationSec);
      $('theme').value = settings.theme;

      applyTheme(settings.theme);
      renderLibrary(catalog);
      renderStats(stored.stats);
      renderGlassUI();

      renderSyncStatus();

      // Live stats: every finished quiz updates the panel in place.
      api.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes.stats) {
          renderStats({ ...DEFAULT_STATS, ...(changes.stats.newValue || {}) });
        }
        if (area === 'local' && changes.lastSyncAt) {
          renderSyncStatus();
        }
      });

      // Library quick filter
      $('libSearch').addEventListener('input', function () {
        var q = this.value.trim().toLowerCase();
        allBoxes().forEach(function (cb) {
          var row = cb.closest('.cat');
          if (!row) return;
          var text = row.textContent.toLowerCase();
          var show = !q || text.indexOf(q) !== -1;
          row.style.display = show ? '' : 'none';
        });
        Array.prototype.slice.call(document.querySelectorAll('.group-hdr')).forEach(function (h) {
          var sib = h.nextElementSibling;
          var anyVisible = false;
          while (sib && !sib.classList.contains('group-hdr')) {
            if (sib.style.display !== 'none') anyVisible = true;
            sib = sib.nextElementSibling;
          }
          h.style.display = anyVisible || !q ? '' : 'none';
        });
      });

      $('enabled').addEventListener('change', function () {
        settings.enabled = this.checked;
        save();
      });
      $('interval').addEventListener('change', function () {
        settings.intervalMin = parseInt(this.value, 10) || 30;
        save();
      });
      $('perQuiz').addEventListener('change', function () {
        settings.perQuiz = parseInt(this.value, 10) || 3;
        save();
      });
      $('duration').addEventListener('change', function () {
        settings.durationSec = parseInt(this.value, 10) || 45;
        save();
      });
      $('theme').addEventListener('change', function () {
        settings.theme = this.value;
        applyTheme(settings.theme);
        save();
      });
      $('glassSeg').addEventListener('click', function (e) {
        var b = e.target.closest('button[data-glass]');
        if (!b || b.dataset.glass === settings.glass) return;
        settings.glass = b.dataset.glass;
        save();
        renderGlassUI();
      });
      $('glassCustom').addEventListener('input', function () {
        settings.glassCustom = parseInt(this.value, 10);
        $('glassCustomVal').textContent = settings.glassCustom + '%';
        applyGlassPreview();
        save();
      });
      $('selAll').addEventListener('click', function () {
        allBoxes().forEach(function (cb) {
          cb.checked = true;
          settings.topics[cb.dataset.id] = true;
        });
        save();
      });
      $('selNone').addEventListener('click', function () {
        allBoxes().forEach(function (cb) {
          cb.checked = false;
          settings.topics[cb.dataset.id] = false;
        });
        save();
      });
      $('startNow').addEventListener('click', startInlineQuiz);
    }).catch(function (err) {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<p style="text-align:center;opacity:.7">Could not load settings: ' + String(err) + '</p>'
      );
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
