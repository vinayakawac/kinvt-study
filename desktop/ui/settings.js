/*
 * Kinvt-study — settings window.
 *
 * Ported from the extension's sidepanel.js. The UI behaviour (collapsible
 * library groups, glass presets, live preview) is unchanged; what's gone is
 * everything that existed only to talk to a background service worker —
 * settings are read and written directly, and "Quiz me now" emits an event
 * rather than negotiating tabs and injection.
 */
(function () {
  'use strict';

  var invoke = window.__TAURI__.core.invoke;
  var emit = window.__TAURI__.event.emit;

  var settings = null;
  var flashTimer = null;

  function $(id) { return document.getElementById(id); }

  var GLASS_VALS = {
    clear:    { o: 0.42, blur: 8,  border: 0.14 },
    balanced: { o: 0.72, blur: 16, border: 0.22 },
    frosted:  { o: 0.90, blur: 24, border: 0.28 }
  };
  var GLASS_HINTS = {
    clear:    'Clear — nearly see-through; whatever is behind stays visible.',
    balanced: 'Balanced — the default; readable over most backgrounds.',
    frosted:  'Frosted — heavy blur and tint; the card almost stands alone.',
    custom:   'Custom — set the glass intensity yourself with the slider.'
  };

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
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/></svg>',
    compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="16 8 14 14 8 16 10 10"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/></svg>'
  };

  function save() {
    window.KinvtQuiz.setSettings(settings);
    // localStorage's `storage` event only fires in *other* documents, which
    // is exactly what's wanted: the quiz window re-arms its timer.
  }

  function glassVals() {
    if (settings.glass === 'custom') {
      var p = parseInt(settings.glassCustom, 10) || 70;
      return { o: p / 100, blur: Math.round(6 + p * 0.18), border: 0.12 + (p / 100) * 0.16 };
    }
    return GLASS_VALS[settings.glass] || GLASS_VALS.balanced;
  }

  function applyGlassPreview() {
    var v = glassVals();
    var pc = $('gpCard');
    pc.style.setProperty('--gp-o', v.o.toFixed(2));
    pc.style.setProperty('--gp-blur', v.blur + 'px');
    pc.style.setProperty('--gp-border', v.border.toFixed(2));
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

  function applyTheme(theme) {
    document.body.classList.remove('light');
    if (theme === 'light') document.body.classList.add('light');
    else if (theme === 'auto' && window.matchMedia &&
             window.matchMedia('(prefers-color-scheme: light)').matches) {
      document.body.classList.add('light');
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
      var items = groups[groupName];
      var anySelected = items.some(function (cat) { return settings.topics[cat.id]; });

      var h = document.createElement('button');
      h.type = 'button';
      h.className = 'group-hdr';
      h.setAttribute('aria-expanded', String(anySelected));
      h.innerHTML =
        '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
        'stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
        '<span>' + groupName + '</span>' +
        '<span class="group-count">' + items.length + '</span>';
      wrap.appendChild(h);

      var body = document.createElement('div');
      body.className = 'group-body';
      body.hidden = !anySelected;
      wrap.appendChild(body);

      h.addEventListener('click', function () {
        var openNow = body.hidden;
        body.hidden = !openNow;
        h.setAttribute('aria-expanded', String(openNow));
      });

      items.forEach(function (cat) {
        var checked = settings.topics[cat.id] ? 'checked' : '';
        var label = document.createElement('label');
        label.className = 'cat';
        label.innerHTML =
          '<input type="checkbox" data-id="' + cat.id + '" ' + checked + '>' +
          '<span class="box"></span>' +
          '<span class="ico">' + (ICONS[cat.icon] || '') + '</span>' +
          '<span class="txt"><b>' + cat.label + '</b><i>' + cat.blurb + '</i></span>';
        body.appendChild(label);
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

  function renderStats() {
    var st = window.KinvtQuiz.getStats();
    $('stAnswered').textContent = st.answered;
    $('stCorrect').textContent = st.correct;
    $('stAcc').textContent = st.answered ? Math.round((st.correct / st.answered) * 100) + '%' : '–';
    $('stStreak').textContent = st.streak;
    var rev = $('stReview');
    if (rev) rev.textContent = window.KinvtQuiz.reviewCount();
  }

  function allBoxes() {
    return Array.prototype.slice.call(document.querySelectorAll('#cats input'));
  }

  function init() {
    settings = window.KinvtQuiz.getSettings();

    $('enabled').checked = settings.enabled;
    $('interval').value = String(settings.intervalMin);
    $('perQuiz').value = String(settings.perQuiz);
    $('duration').value = String(settings.durationSec);
    $('theme').value = settings.theme;

    applyTheme(settings.theme);
    renderGlassUI();
    renderStats();

    window.KinvtQuiz.loadLibrary().then(renderLibrary).catch(function (err) {
      $('cats').textContent = 'Could not load the library: ' + err;
    });

    $('enabled').addEventListener('change', function () { settings.enabled = this.checked; save(); });
    $('interval').addEventListener('change', function () { settings.intervalMin = parseInt(this.value, 10) || 30; save(); });
    $('perQuiz').addEventListener('change', function () { settings.perQuiz = parseInt(this.value, 10) || 3; save(); });
    $('duration').addEventListener('change', function () { settings.durationSec = parseInt(this.value, 10) || 45; save(); });
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
      allBoxes().forEach(function (cb) { cb.checked = true; settings.topics[cb.dataset.id] = true; });
      save();
    });
    $('selNone').addEventListener('click', function () {
      allBoxes().forEach(function (cb) { cb.checked = false; settings.topics[cb.dataset.id] = false; });
      save();
    });

    $('libSearch').addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      allBoxes().forEach(function (cb) {
        var row = cb.closest('.cat');
        if (!row) return;
        row.style.display = (!q || row.textContent.toLowerCase().indexOf(q) !== -1) ? '' : 'none';
      });
      Array.prototype.slice.call(document.querySelectorAll('.group-hdr')).forEach(function (h) {
        var body = h.nextElementSibling;
        if (!body || !body.classList.contains('group-body')) return;
        var anyVisible = Array.prototype.slice.call(body.querySelectorAll('.cat'))
          .some(function (row) { return row.style.display !== 'none'; });
        h.style.display = (anyVisible || !q) ? '' : 'none';
        body.hidden = q ? !anyVisible : !body.querySelector('input:checked');
        h.setAttribute('aria-expanded', String(!body.hidden));
      });
    });

    $('startNow').addEventListener('click', function () {
      // Only emit — the quiz window shows itself once the card is built.
      // Showing it here first would flash an empty transparent window.
      emit('start-quiz');
      var span = this.querySelector('span');
      if (flashTimer) clearTimeout(flashTimer);
      span.textContent = 'Quiz launched';
      flashTimer = setTimeout(function () { span.textContent = 'Quiz me now'; }, 1800);
    });

    // Stats change in the quiz window, so refresh when it writes them.
    window.addEventListener('storage', function (e) {
      if (e.key === 'kinvt.stats') renderStats();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
