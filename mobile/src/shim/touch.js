/*
 * Kinvt-study — Android touch response.
 *
 * A webview's press feedback is a browser's press feedback, and on a phone
 * that is what makes an app read as a web page in a frame. Three of the
 * differences need JavaScript; the rest are in mobile.css.
 *
 *   :active sticks through a flick     CSS cannot tell a press from the start
 *                                      of a scroll, so a button stays lit while
 *                                      the list slides away under it. A native
 *                                      Android button lets go the moment the
 *                                      finger travels. This tracks the pointer
 *                                      and does the same.
 *
 *   there is no ripple                 Material's feedback grows from the point
 *                                      of contact, which is what makes a tap
 *                                      read as landing somewhere rather than as
 *                                      a colour changing nearby.
 *
 *   :hover sticks after a tap          A webview leaves the tapped element in
 *                                      :hover until something else is tapped,
 *                                      so a visited tab stays highlighted.
 *                                      mobile.css neutralises hover on touch;
 *                                      the press state here replaces it.
 *
 * Everything is delegated from the document, so elements rendered later — quiz
 * options, the library list, a re-rendered peer row — are covered without any
 * of them knowing this file exists.
 */
(function (global) {
  'use strict';
  if (!global.Capacitor) return;

  // Anything meant to be pressed. Inputs and selects are deliberately absent:
  // they get the platform's own touch treatment and should keep it.
  var PRESSABLE = '.mq-opt, .mq-next, .mq-close, .mq-src, .kq-tab, .btn, .primary, .cat';

  // How far a finger may travel and still count as a press rather than a
  // scroll. Android's own threshold is ~8dp; a little more is forgiving
  // without ever swallowing a flick.
  var SLOP = 12;

  var target = null;
  var startX = 0;
  var startY = 0;

  function disabled(node) {
    return node.disabled || node.getAttribute('aria-disabled') === 'true';
  }

  function release() {
    if (!target) return;
    target.classList.remove('is-press');
    target = null;
  }

  // ---- ripple ----
  // The circle has to cover the element from wherever it was touched, so its
  // radius is the distance to the farthest corner.
  function ripple(node, x, y) {
    var box = node.getBoundingClientRect();
    var cx = x - box.left;
    var cy = y - box.top;
    var r = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(box.width - cx, cy),
      Math.hypot(cx, box.height - cy),
      Math.hypot(box.width - cx, box.height - cy)
    );

    var ink = document.createElement('span');
    ink.className = 'kq-ink';
    ink.style.width = ink.style.height = (r * 2) + 'px';
    ink.style.left = (cx - r) + 'px';
    ink.style.top = (cy - r) + 'px';
    node.appendChild(ink);

    // animationend is enough on its own; the timer only covers the case where
    // the element is hidden mid-animation and the event never arrives, which
    // would otherwise leak a span into every quiz option.
    var gone = false;
    function drop() {
      if (gone) return;
      gone = true;
      if (ink.parentNode) ink.parentNode.removeChild(ink);
    }
    ink.addEventListener('animationend', drop);
    global.setTimeout(drop, 700);
  }

  // ---- haptics ----
  // Only where Android itself would buzz: a selection changing. Ordinary
  // buttons do not vibrate on this platform, and adding it everywhere is the
  // fastest way to make an app feel cheap.
  function haptic() {
    var H = global.Capacitor.Plugins && global.Capacitor.Plugins.Haptics;
    if (!H) return;
    (H.selectionStart ? H.selectionStart() : H.impact({ style: 'LIGHT' }))
      .then(function () { return H.selectionEnd && H.selectionEnd(); })
      .catch(function () { /* no vibrator, or the user has haptics off */ });
  }
  global.KinvtHaptic = haptic;

  // ---- press tracking ----
  // Capture phase: the press state must be applied before anything downstream
  // can stop propagation, and removed even if it does.
  document.addEventListener('pointerdown', function (e) {
    release();
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    var node = e.target.closest && e.target.closest(PRESSABLE);
    if (!node || disabled(node)) return;

    target = node;
    startX = e.clientX;
    startY = e.clientY;
    node.classList.add('is-press');
    ripple(node, e.clientX, e.clientY);
  }, true);

  document.addEventListener('pointermove', function (e) {
    if (!target) return;
    if (Math.abs(e.clientX - startX) > SLOP || Math.abs(e.clientY - startY) > SLOP) release();
  }, true);

  ['pointerup', 'pointercancel', 'pointerleave', 'contextmenu'].forEach(function (type) {
    document.addEventListener(type, release, true);
  });

  // A scroll that starts on a button never produces a pointermove on some
  // devices — the gesture is claimed by the scroller first — so the scroll
  // itself is also treated as "that was not a press".
  document.addEventListener('scroll', release, true);
})(typeof window !== 'undefined' ? window : globalThis);
