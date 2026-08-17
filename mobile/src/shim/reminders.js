/*
 * Kinvt-study — Android study reminders.
 *
 * The desktop floats an always-on-top card. Android has no equivalent and
 * should not fake one: the native idiom is a notification that opens the quiz
 * when tapped.
 *
 * Scheduling lays out a rolling window of individual notifications rather than
 * one repeating alarm, because the interval is a user setting and quiet hours
 * cut holes in the schedule. Each launch clears and re-lays the next few.
 *
 * Reminders are INEXACT by design. Doze batches alarms, so one may arrive a
 * few minutes late; for a study prompt that is correct behaviour and far
 * kinder to the battery than demanding the exact-alarm permission, which
 * Android 12+ restricts heavily.
 */
(function (global) {
  'use strict';
  var LN = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.LocalNotifications;
  if (!LN) return;

  var AHEAD = 8;                      // how many reminders to lay out at once
  var CHANNEL = 'kinvt-study';
  var FIRST_ID = 1000;

  function pending() {
    var out = [];
    for (var i = 0; i < AHEAD; i++) out.push({ id: FIRST_ID + i });
    return out;
  }

  function schedule() {
    var s = global.KinvtQuiz.getSettings();
    if (!s.enabled) return LN.cancel({ notifications: pending() }).catch(function () {});

    var every = Math.max(2, Math.round(s.intervalMin) || 30);
    var qs = typeof s.quietStart === 'number' ? s.quietStart : 1320;
    var qe = typeof s.quietEnd === 'number' ? s.quietEnd : 420;

    var list = [];
    var when = new Date();
    for (var i = 0; i < AHEAD; i++) {
      when = new Date(when.getTime() + every * 60000);
      var mins = when.getHours() * 60 + when.getMinutes();
      if (global.KinvtQuietHours.isQuiet(mins, qs, qe)) {
        // Jump to the end of the quiet window rather than dropping the slot,
        // otherwise a long night would consume the whole rolling window and
        // leave nothing scheduled for the morning.
        var next = global.KinvtQuietHours.nextAllowed(mins, qs, qe);
        when = new Date(when.getTime() + (next - mins) * 60000);
      }
      list.push({
        id: FIRST_ID + i,
        title: 'Time for a quick quiz',
        body: s.perQuiz + (s.perQuiz === 1 ? ' question' : ' questions') + ' ready',
        schedule: { at: new Date(when.getTime()), allowWhileIdle: false },
        channelId: CHANNEL,
        smallIcon: 'ic_stat_kinvt'
      });
    }

    return LN.cancel({ notifications: pending() })
      .catch(function () { /* nothing pending yet */ })
      .then(function () { return LN.schedule({ notifications: list }); });
  }

  function init() {
    return LN.createChannel({
      id: CHANNEL,
      name: 'Study reminders',
      importance: 3,          // shows in the shade without interrupting
      visibility: 1
    }).catch(function () { /* older Android has no channels */ })
      .then(function () { return LN.checkPermissions(); })
      .then(function (p) {
        return p.display === 'granted' ? p : LN.requestPermissions();
      })
      .then(function (p) {
        // Refusal is a valid choice: the app stays fully usable as
        // open-and-practise, it just will not interrupt.
        return p.display === 'granted' ? schedule() : null;
      })
      .catch(function () { return null; });
  }

  LN.addListener('localNotificationActionPerformed', function () {
    if (global.KinvtMobile && global.KinvtMobile.startQuiz) global.KinvtMobile.startQuiz();
  });

  global.KinvtReminders = { schedule: schedule, init: init };

  // Re-lay the schedule when settings change, or a new interval would not take
  // effect until the existing window drained.
  global.addEventListener('storage', function (e) {
    if (e.key === 'kinvt.settings') schedule();
  });
})(typeof window !== 'undefined' ? window : globalThis);
