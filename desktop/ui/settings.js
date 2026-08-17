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

  // Outside a shell — the browser preview, or a page opened directly — there
  // is no __TAURI__ at all, and reading through it threw before a single line
  // of the page rendered. The stub keeps everything except the shell calls
  // working, which is what makes settings.html previewable without building.
  var TAURI = window.__TAURI__ || {
    core: { invoke: function () { return Promise.resolve(); } },
    event: { emit: function () {}, listen: function () {} }
  };
  var invoke = TAURI.core.invoke;
  var emit = TAURI.event.emit;

  var settings = null;
  var flashTimer = null;
  var topicLabels = {};   // id -> human label, filled once the library loads

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
    // The OS draws the title bar, so it has to be told separately — otherwise
    // a light page keeps a dark caption and the window looks half-themed.
    var dark = !document.body.classList.contains('light');
    try { invoke('set_titlebar_theme', { dark: dark }); } catch (e) { /* not in the shell */ }
  }

  function renderLibrary(catalog) {
    var wrap = $('cats');
    wrap.innerHTML = '';
    catalog.forEach(function (cat) { topicLabels[cat.id] = cat.label; });

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

  // Weakest topic first — that is the row worth acting on. Alphabetical order
  // would bury it among the ones you already know.
  function renderTopicStats() {
    var host = $('topicStats');
    if (!host) return;
    var rows = window.KinvtQuiz.topicBreakdown();
    if (!rows.length) {
      host.innerHTML = '<p class="hint">No questions answered yet — your weakest topics will appear here.</p>';
      return;
    }
    host.innerHTML = rows.map(function (r) {
      var name = topicLabels[r.id] || r.id;
      if (r.accuracy === null || !r.answered) {
        return '<div class="trow muted"><span class="tname">' + name + '</span>' +
               '<span class="tval">not started</span></div>';
      }
      var pct = Math.round(r.accuracy * 100);
      return '<div class="trow">' +
        '<span class="tname">' + name + '</span>' +
        '<span class="tbar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="tval">' + pct + '% <em>' + r.answered + '</em></span>' +
        '</div>';
    }).join('');
  }

  function renderStats() {
    var st = window.KinvtQuiz.getStats();
    // Totals are summed across devices rather than stored, so that syncing a
    // phone in does not double-count anything.
    var t = window.KinvtMerge.totals(st);
    $('stAnswered').textContent = t.answered;
    $('stCorrect').textContent = t.correct;
    $('stAcc').textContent = t.answered ? Math.round((t.correct / t.answered) * 100) + '%' : '–';
    $('stStreak').textContent = window.KinvtQuiz.streak();
    var rev = $('stReview');
    if (rev) rev.textContent = window.KinvtQuiz.reviewCount();

    var sync = $('stSync');
    if (sync) {
      var at = window.KinvtQuiz.lastSyncAt();
      sync.textContent = at
        ? 'Question banks last updated ' + new Date(at).toLocaleString()
        : 'Question banks not yet updated from the repository';
    }
    renderTopicStats();
  }

  function allBoxes() {
    return Array.prototype.slice.call(document.querySelectorAll('#cats input'));
  }

  function init() {
    settings = window.KinvtQuiz.getSettings();

    $('enabled').checked = settings.enabled;
    $('perQuiz').value = String(settings.perQuiz);
    $('duration').value = String(settings.durationSec);
    $('theme').value = settings.theme;

    applyTheme(settings.theme);
    renderGlassUI();
    renderStats();

    window.KinvtQuiz.loadLibrary().then(function (catalog) {
      renderLibrary(catalog);
      renderTopicStats();   // labels are known now
    }).catch(function (err) {
      $('cats').textContent = 'Could not load the library: ' + err;
    });

    $('enabled').addEventListener('change', function () { settings.enabled = this.checked; save(); });
    /* ---- popup interval ----
     * The presets cover the common choices, but "every 20 minutes" is a
     * perfectly reasonable thing to want and no list of presets can cover
     * everyone. Any value the dropdown does not offer selects Custom and
     * fills the number box, so a custom interval survives a reload rather
     * than silently snapping back to a preset.
     *
     * Floor of 2 minutes: below that the popup stops being a study prompt and
     * becomes an interruption you would turn off entirely.
     */
    var MIN_INTERVAL = 2;
    var MAX_INTERVAL = 1440;

    function clampInterval(v) {
      var n = Math.round(parseInt(v, 10) || 0);
      return Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, n || 30));
    }

    function isPreset(v) {
      return Array.prototype.some.call($('interval').options, function (o) {
        return o.value !== 'custom' && parseInt(o.value, 10) === v;
      });
    }

    function renderInterval() {
      var v = clampInterval(settings.intervalMin);
      var custom = !isPreset(v);
      $('interval').value = custom ? 'custom' : String(v);
      $('intervalCustomRow').hidden = !custom;
      $('intervalCustom').value = String(v);
    }

    $('interval').addEventListener('change', function () {
      if (this.value === 'custom') {
        $('intervalCustomRow').hidden = false;
        $('intervalCustom').focus();
        return;                       // nothing saved until a number is given
      }
      settings.intervalMin = clampInterval(this.value);
      $('intervalCustomRow').hidden = true;
      save();
    });

    $('intervalCustom').addEventListener('change', function () {
      settings.intervalMin = clampInterval(this.value);
      this.value = String(settings.intervalMin);   // show what was actually stored
      save();
    });

    renderInterval();
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

    /* ---- adaptation and do-not-disturb ---- */

    $('adaptive').checked = settings.adaptive !== false;
    $('respectDnd').checked = settings.respectDnd !== false;
    $('adaptive').addEventListener('change', function () { settings.adaptive = this.checked; save(); });
    $('respectDnd').addEventListener('change', function () { settings.respectDnd = this.checked; save(); });

    /* ---- quiet hours ----
     * Stored as minutes since midnight, which keeps timezones and dates out
     * of the comparison entirely.
     */
    function toMinutes(v) {
      var p = String(v || '').split(':');
      return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
    }
    function toTime(m) {
      var h = Math.floor((m || 0) / 60), mm = (m || 0) % 60;
      return ('0' + h).slice(-2) + ':' + ('0' + mm).slice(-2);
    }
    $('quietStart').value = toTime(settings.quietStart != null ? settings.quietStart : 1320);
    $('quietEnd').value = toTime(settings.quietEnd != null ? settings.quietEnd : 420);
    $('quietStart').addEventListener('change', function () { settings.quietStart = toMinutes(this.value); save(); });
    $('quietEnd').addEventListener('change', function () { settings.quietEnd = toMinutes(this.value); save(); });

    /* ---- backup and restore ----
     * This data exists nowhere else: no account, no server. Restore therefore
     * merges rather than replaces, and merging is idempotent, so restoring
     * the same file twice is harmless.
     */
    function backupMsg(text) { $('backupMsg').textContent = text; }

    $('exportBtn').addEventListener('click', function () {
      var stamp = new Date().toISOString().slice(0, 10);
      var payload = JSON.stringify(window.KinvtQuiz.exportPayload(), null, 2);
      var dialog = window.__TAURI__ && window.__TAURI__.dialog;

      if (dialog && dialog.save) {
        dialog.save({
          defaultPath: 'kinvt-study-backup-' + stamp + '.json',
          filters: [{ name: 'JSON', extensions: ['json'] }]
        }).then(function (path) {
          if (!path) return;                       // cancelled
          return invoke('write_backup', { path: path, contents: payload })
            .then(function () { backupMsg('Backed up to ' + path); });
        }).catch(function (e) { backupMsg('Backup failed: ' + e); });
      } else {
        // No native dialog (Electron, or a preview in the browser): fall back
        // to a download rather than leaving the button dead.
        var blob = new Blob([payload], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'kinvt-study-backup-' + stamp + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        backupMsg('Backup downloaded.');
      }
    });

    $('importBtn').addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var payload;
          try { payload = JSON.parse(reader.result); }
          catch (e) { backupMsg('That file is not valid JSON.'); return; }

          var res = window.KinvtQuiz.importPayload(payload);
          if (!res.ok) { backupMsg('Could not restore: ' + res.error); return; }

          settings = window.KinvtQuiz.getSettings();
          renderStats();
          backupMsg('Restored. Your existing progress was merged, not replaced.');
        };
        reader.readAsText(file);
      });
      input.click();
    });

    /* ---- pairing a phone ----
     * The QR carries the key, which is the whole security model: it crosses
     * optically and never touches the network, so the HTTP transport only ever
     * moves ciphertext. It is therefore rendered and nothing else — never
     * logged, never copied to the clipboard, never put in the title.
     */
    var pairTimer = null;

    function renderPeers() {
      var peers = window.KinvtPairing.listPeers();
      $('peerList').innerHTML = peers.length
        ? peers.map(function (p) {
            return '<div class="row"><span>' + p.name + '</span>' +
              '<span class="hint">' +
              (p.lastSyncAt ? 'last synced ' + new Date(p.lastSyncAt).toLocaleString() : 'never synced') +
              '</span><button type="button" class="link" data-forget="' + p.deviceId + '">Forget</button></div>';
          }).join('')
        : '<p class="hint">No devices paired yet.</p>';
    }

    function stopPairing(message) {
      if (pairTimer) { clearTimeout(pairTimer); pairTimer = null; }
      $('pairQr').hidden = true;
      $('pairQr').innerHTML = '';
      invoke('sync_stop');
      $('pairMsg').textContent = message || '';
      renderPeers();
    }

    $('pairBtn').addEventListener('click', function () {
      $('pairMsg').textContent = 'Starting…';
      invoke('sync_listen').then(function (addr) {
        if (!addr || !addr.port) throw new Error('the listener did not start');
        return window.KinvtSyncCrypto.newKey().then(function (key) {
          var expiresAt = Date.now() + window.KinvtPairing.PAIRING_TTL_MS;
          var url = window.KinvtPairing.buildUrl({
            host: addr.host,
            port: addr.port,
            key: key,
            deviceId: window.KinvtProgress.thisDevice(),
            expiresAt: expiresAt
          });

          // Accept this key for whichever device scans the code during the
          // window. The phone sends its id, and it is stored on first contact.
          window.KinvtPairing.savePeer('pending', key, 'Pending');

          $('pairQr').innerHTML = window.KinvtQR.toSvg(url, 220);
          $('pairQr').hidden = false;
          $('pairMsg').textContent = 'Scan this with the phone app — expires in 2 minutes.';

          pairTimer = setTimeout(function () {
            stopPairing('Pairing code expired.');
          }, window.KinvtPairing.PAIRING_TTL_MS);
        });
      }).catch(function (e) {
        $('pairMsg').textContent = 'Could not start pairing: ' + (e && e.message ? e.message : e);
      });
    });

    // Forgetting a device deletes the shared key, so it cannot sync again
    // without scanning a fresh code.
    $('peerList').addEventListener('click', function (e) {
      var id = e.target && e.target.getAttribute && e.target.getAttribute('data-forget');
      if (!id) return;
      window.KinvtPairing.forgetPeer(id);
      renderPeers();
    });

    renderPeers();

    // Stats change in the quiz window, so refresh when it writes them.
    window.addEventListener('storage', function (e) {
      if (e.key === 'kinvt.stats') renderStats();
      if (e.key === 'kinvt.peers') renderPeers();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
