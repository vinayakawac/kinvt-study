/*
 * Kinvt-study — making the shared settings page tell the truth on Android.
 *
 * desktop/ui/settings.html is the single source for both shells, so the phone
 * inherits every control the desktop needs — including the ones that only mean
 * something to a floating window on a desktop. They were not merely useless
 * here; they were worse than useless, because they looked adjustable. A user
 * who set "Auto-close after 30 seconds" was configuring a timer that no code
 * on this device reads, and had no way to find that out.
 *
 * Each removal below was traced to its consumer before it was made:
 *
 *   Auto-close after      durationSec is read by ui-core.js and app.js, the
 *                         desktop popup and its window controller.
 *                         mobile-quiz.js has no timer and never reads it.
 *   Stay quiet when busy  respectDnd is read only by app.js, which the mobile
 *                         build drops. Android notifications already obey the
 *                         system Do Not Disturb without being asked.
 *   Glass & transparency  glass is read only by ui-core.js, to decide how far
 *                         through the floating card you can see the desktop
 *                         behind it. The Android quiz is opaque and full
 *                         bleed; there is nothing behind it to show through.
 *   Back up progress…     with no Tauri dialog it falls through to an <a
 *                         download>, and a Capacitor webview has no download
 *                         listener, so the button did nothing at all.
 *
 * The pairing button is a different kind of wrong: it ran the DESKTOP half of
 * the handshake, listening on a socket and drawing a code for someone else to
 * scan. The phone is the half with the camera. scan.js has had the correct
 * flow all along and nothing ever called it.
 *
 * Timing: this runs after settings.js has bound its handlers. Removing these
 * nodes any earlier would leave settings.js calling addEventListener on null,
 * which takes the whole settings page down with it.
 */
(function (global) {
  'use strict';
  if (!global.Capacitor) return;

  function $(id) { return document.getElementById(id); }

  function dropRow(id) {
    var el = $(id);
    var row = el && el.closest('.row');
    if (row && row.parentNode) row.parentNode.removeChild(row);
  }

  // Not dropRow: exportBtn shares its .backup-row with Restore and Reset,
  // which both work here, so the closest row is far too much to take.
  function dropSelf(id) {
    var el = $(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function labelSaying(text) {
    var labels = document.querySelectorAll('.row .lbl');
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].textContent.trim() === text) return labels[i];
    }
    return null;
  }

  function relabel(id, text) {
    var el = document.querySelector('label[for="' + id + '"]');
    if (el) el.textContent = text;
  }

  // Hints are matched on a phrase rather than a position: the paragraphs have
  // no ids, and counting from the end would silently retarget the moment
  // anyone adds a sentence to the desktop page.
  function hintSaying(phrase) {
    var hints = document.querySelectorAll('.hint');
    for (var i = 0; i < hints.length; i++) {
      if (hints[i].textContent.indexOf(phrase) !== -1) return hints[i];
    }
    return null;
  }

  function prune() {
    // ---- controls nothing on this device reads ----
    dropRow('duration');
    dropRow('respectDnd');
    dropSelf('exportBtn');

    var glass = document.querySelector('.glass-sub');
    if (glass && glass.parentNode) glass.parentNode.removeChild(glass);

    // ---- a popup on the desktop is a notification here ----
    var master = labelSaying('Quiz popups');
    if (master) master.textContent = 'Quiz reminders';
    relabel('interval', 'Remind me every');
    relabel('perQuiz', 'Questions per quiz');

    var behaviour = hintSaying('Focus Assist');
    if (behaviour) {
      behaviour.textContent =
        'Lightning mode keeps serving questions one after another instead of ' +
        'stopping after a set number — close it when you have had enough. ' +
        'Adapting weights your weaker topics more heavily and matches ' +
        'difficulty to your recent accuracy.';
    }
    // A keyboard shortcut and a tray icon, on a phone with neither.
    var hotkey = hintSaying('Ctrl + Shift + Q');
    if (hotkey && hotkey.parentNode) hotkey.parentNode.removeChild(hotkey);

    // ---- the toggle that was lying ----
    // lightning defaults to null, which the desktop reads as off and Android
    // as on. settings.js renders `=== true`, so the switch sat off while the
    // app was running in lightning mode — and turning it on and back off was
    // the only way to make the switch and the behaviour agree.
    var lightning = $('lightning');
    if (lightning) lightning.checked = global.KinvtQuiz.getSettings().lightning !== false;

    pairing();
  }

  // ---- pairing, pointed the right way round ----
  function pairing() {
    var btn = $('pairBtn');
    if (!btn) return;

    var intro = hintSaying('Sync your progress with your phone');
    if (intro) {
      intro.textContent =
        'Open Settings → Devices on the desktop, tap Pair a device there, then ' +
        'scan the code it shows. Nothing is sent to any server and no account ' +
        'is needed — the key travels in the code, never over the network.';
    }

    if (!global.KinvtScan) {
      // No barcode plugin on this build: say so rather than leave a button
      // that opens nothing.
      btn.disabled = true;
      btn.textContent = 'Scanning unavailable';
      return;
    }

    // Replacing the node rather than adding a listener: settings.js has
    // already bound the desktop handler to this button, and that handler calls
    // invoke('sync_listen'), which has no bridge here. A second listener would
    // not stop the first from firing and failing.
    var scan = btn.cloneNode(false);
    scan.textContent = 'Scan the desktop code';
    btn.parentNode.replaceChild(scan, btn);

    var msg = $('pairMsg');
    function say(text) { if (msg) msg.textContent = text; }

    scan.addEventListener('click', function () {
      say('Opening the camera…');
      scan.disabled = true;
      global.KinvtScan.pair(function () {
        // Only fires on a device whose Play Services has never fetched the
        // scanner module — a one-time download, and worth naming so the wait
        // does not read as a hang.
        say('Setting up the QR scanner (one-time download)…');
      }).then(function () {
        say('Paired and synced.');
        if (global.KinvtNav) global.KinvtNav.refresh();
      }).catch(function (e) {
        say(e && e.message ? e.message : 'Pairing failed.');
      }).then(function () {
        scan.disabled = false;
      });
    });

    // The desktop's QR surface: this device scans codes, it does not show them.
    var qr = $('pairQr');
    if (qr && qr.parentNode) qr.parentNode.removeChild(qr);
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Queued behind settings.js's own setup and mobile-nav.js's reparenting,
    // both of which run from their own deferred pass.
    setTimeout(prune, 0);
  });
})(typeof window !== 'undefined' ? window : globalThis);
