/*
 * Kinvt-study — the hours when the app should stay silent.
 *
 * All times are minutes since midnight, which removes both timezone handling
 * and date arithmetic from the problem.
 *
 * The case worth care is a window that wraps midnight — 22:00 to 07:00, which
 * is also the default and by far the most common. A naive `start <= now < end`
 * silences nothing at all for that window, because 22:00 is not less than
 * 07:00.
 *
 * Shared by the desktop (which skips a scheduled popup) and Android (which
 * moves a notification to the end of the window), so the two cannot disagree
 * about when night is.
 */
(function (global) {
  'use strict';

  var DAY = 24 * 60;

  function isQuiet(now, start, end) {
    if (start === end) return false;               // an empty window
    if (start < end) return now >= start && now < end;
    return now >= start || now < end;              // wraps midnight
  }

  // The next minute at which a reminder may fire. Returns a value beyond one
  // day when the window ends tomorrow, so callers can add it to today without
  // a separate date calculation.
  function nextAllowed(now, start, end) {
    if (!isQuiet(now, start, end)) return now;
    return now >= end ? end + DAY : end;
  }

  // Convenience for callers holding a Date rather than a minute count.
  function isQuietAt(date, settings) {
    var mins = date.getHours() * 60 + date.getMinutes();
    var s = typeof settings.quietStart === 'number' ? settings.quietStart : 1320;
    var e = typeof settings.quietEnd === 'number' ? settings.quietEnd : 420;
    return isQuiet(mins, s, e);
  }

  global.KinvtQuietHours = {
    DAY: DAY,
    isQuiet: isQuiet,
    nextAllowed: nextAllowed,
    isQuietAt: isQuietAt
  };
})(typeof window !== 'undefined' ? window : globalThis);
