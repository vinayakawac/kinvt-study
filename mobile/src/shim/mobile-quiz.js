/*
 * Kinvt-study — the Android quiz screen, built for a phone.
 *
 * TPQ_UI is a small floating card: 400px wide, glass background, a close
 * timer, sized to hover over other work. Every one of those choices is right
 * for a desktop popup and wrong for a phone, where the quiz IS the screen and
 * the user came here on purpose.
 *
 * So this is a separate renderer rather than the card with mobile CSS bolted
 * on. It shares everything that matters — the same banks, the same recording
 * of answers, the same review queue — and differs only in presentation:
 *
 *   full bleed, no card chrome        the screen is the card
 *   large type and 56px targets       thumbs, not cursors
 *   progress as a thin top rail       position without stealing height
 *   answer feedback in place          no modal, no layout jump
 *   a running session counter         lightning mode has no "3/3" to show
 */
(function (global) {
  'use strict';
  if (!global.Capacitor) return;

  var LETTERS = ['A', 'B', 'C', 'D'];

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  // One quiz session: a stream of questions, however many batches it takes.
  function Session(host, opts) {
    this.host = host;
    this.opts = opts || {};
    this.queue = [];
    this.seen = 0;
    this.right = 0;
    this.answered = false;
    this.build();
  }

  Session.prototype.build = function () {
    var self = this;
    this.host.innerHTML = '';

    var root = el('div', 'mq');
    root.innerHTML =
      '<div class="mq-rail"><i></i></div>' +
      '<header class="mq-top">' +
        '<button type="button" class="mq-close" aria-label="Close quiz">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
          '<path d="M18 6 6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<span class="mq-count"></span>' +
        '<span class="mq-score"></span>' +
      '</header>' +
      '<div class="mq-body">' +
        '<p class="mq-topic"></p>' +
        '<h2 class="mq-q"></h2>' +
        '<div class="mq-opts"></div>' +
        '<div class="mq-fb" hidden>' +
          '<p class="mq-verdict"></p>' +
          '<p class="mq-expl"></p>' +
          '<a class="mq-src" hidden>Check the source</a>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="mq-next" hidden>Next</button>';
    this.host.appendChild(root);

    this.root = root;
    this.rail = root.querySelector('.mq-rail i');
    this.countEl = root.querySelector('.mq-count');
    this.scoreEl = root.querySelector('.mq-score');
    this.topicEl = root.querySelector('.mq-topic');
    this.qEl = root.querySelector('.mq-q');
    this.optsEl = root.querySelector('.mq-opts');
    this.fbEl = root.querySelector('.mq-fb');
    this.verdictEl = root.querySelector('.mq-verdict');
    this.explEl = root.querySelector('.mq-expl');
    this.srcEl = root.querySelector('.mq-src');
    this.nextEl = root.querySelector('.mq-next');

    root.querySelector('.mq-close').addEventListener('click', function () { self.end(); });
    this.nextEl.addEventListener('click', function () { self.advance(); });
    this.optsEl.addEventListener('click', function (e) {
      var b = e.target.closest('.mq-opt');
      if (b && !self.answered) self.answer(parseInt(b.getAttribute('data-i'), 10));
    });
    this.srcEl.addEventListener('click', function (e) {
      e.preventDefault();
      var url = self.srcEl.getAttribute('data-url');
      if (url && global.Capacitor.Plugins && global.Capacitor.Plugins.Browser) {
        global.Capacitor.Plugins.Browser.open({ url: url });
      } else if (url) {
        global.open(url, '_blank');
      }
    });
  };

  Session.prototype.fill = function () {
    var self = this;
    return global.KinvtQuiz.buildQuiz().then(function (quiz) {
      if (!quiz || !quiz.questions.length) return false;
      self.queue = self.queue.concat(quiz.questions);
      self.title = quiz.title;
      return true;
    });
  };

  Session.prototype.start = function () {
    var self = this;
    return this.fill().then(function (ok) {
      if (!ok) { self.end(); return; }
      self.render();
    });
  };

  Session.prototype.render = function () {
    var q = this.queue.shift();
    if (!q) return this.refillOrEnd();

    this.current = q;
    this.answered = false;
    this.seen += 1;

    this.countEl.textContent = 'Question ' + this.seen;
    this.scoreEl.textContent = this.seen > 1
      ? this.right + '/' + (this.seen - 1) + ' correct' : '';
    this.topicEl.textContent = q.topic || this.title || '';
    this.qEl.textContent = q.question;

    this.optsEl.innerHTML = q.options.map(function (o, i) {
      return '<button type="button" class="mq-opt" data-i="' + i + '">' +
        '<span class="mq-letter">' + LETTERS[i] + '</span>' +
        '<span class="mq-text"></span></button>';
    }).join('');
    // Options are set as text, never HTML: a question is data, not markup.
    var texts = this.optsEl.querySelectorAll('.mq-text');
    for (var i = 0; i < texts.length; i++) texts[i].textContent = q.options[i];

    this.fbEl.hidden = true;
    this.nextEl.hidden = true;
    this.rail.style.width = '0%';
    this.root.querySelector('.mq-body').scrollTop = 0;
  };

  Session.prototype.answer = function (i) {
    if (this.answered) return;
    this.answered = true;

    var q = this.current;
    var correct = (i === q.answer);
    if (correct) this.right += 1;

    var btns = this.optsEl.querySelectorAll('.mq-opt');
    for (var k = 0; k < btns.length; k++) {
      btns[k].disabled = true;
      if (k === q.answer) btns[k].classList.add('is-right');
      else if (k === i) btns[k].classList.add('is-wrong');
      else btns[k].classList.add('is-dim');
    }

    this.verdictEl.textContent = correct ? 'Correct' : 'Not quite';
    this.verdictEl.className = 'mq-verdict ' + (correct ? 'ok' : 'bad');
    this.explEl.textContent = q.explanation || '';

    var src = typeof q.source === 'string' && q.source.indexOf('http') === 0 ? q.source : '';
    this.srcEl.hidden = !src;
    this.srcEl.setAttribute('data-url', src);

    this.fbEl.hidden = false;
    this.nextEl.hidden = false;
    this.rail.style.width = '100%';

    try { global.KinvtQuiz.recordAnswer(q, correct); } catch (e) { /* noop */ }
    if (global.Capacitor.Plugins && global.Capacitor.Plugins.Haptics) {
      global.Capacitor.Plugins.Haptics.impact({ style: correct ? 'LIGHT' : 'MEDIUM' })
        .catch(function () { /* no haptics on this device */ });
    }
  };

  Session.prototype.advance = function () {
    if (this.queue.length) return this.render();
    this.refillOrEnd();
  };

  // Lightning mode lives here: an empty queue is refilled rather than ending
  // the session, so questions keep coming until the user closes it.
  Session.prototype.refillOrEnd = function () {
    var self = this;
    if (!this.opts.lightning) return this.end();
    this.fill().then(function (ok) {
      if (ok) self.render(); else self.end();
    });
  };

  Session.prototype.end = function () {
    try { global.KinvtQuiz.recordResult(this.right, this.seen); } catch (e) { /* noop */ }
    if (typeof this.opts.onClose === 'function') this.opts.onClose(this.seen, this.right);
  };

  global.KinvtQuizUI = {
    open: function (host, opts) {
      var s = new Session(host, opts);
      s.start();
      return s;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
