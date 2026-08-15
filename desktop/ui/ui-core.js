/*
 * Kinvt-study — shared quiz card UI (ui-core.js)
 * ---------------------------------------------------------------
 * Classic (non-module) script: defines window.TPQ_UI.
 * Loaded two ways:
 *   - content-script overlay.js (isolated world, renders inside a shadow root)
 *   - quiz-window.js (extension page, renders into a normal <div>)
 *
 * Low-CPU discipline:
 *   - ONE delegated click listener, ONE keydown listener.
 *   - ONE setTimeout for the auto-close countdown; cleared on close.
 *   - The countdown progress bar is a single CSS transition (no timers,
 *     no requestAnimationFrame loops).
 *   - All entry animations run once and stop.
 */
(function (global) {
  'use strict';

  var LETTERS = ['A', 'B', 'C', 'D'];

  /* ---- Glass & transparency presets (settings-driven, monochrome) ---- */
  var GLASS_PRESETS = {
    clear:    { o: 0.42, blur: 8,  border: 0.14 },   // nearly see-through
    balanced: { o: 0.72, blur: 16, border: 0.22 },   // readable over most pages
    frosted:  { o: 0.90, blur: 24, border: 0.28 }    // heavy blur, almost solid
  };

  function glassVals(cfg) {
    if (cfg && cfg.glass === 'custom') {
      var p = Math.max(35, Math.min(92, cfg.glassCustom | 0 || 70));
      return { o: p / 100, blur: Math.round(6 + p * 0.18), border: 0.12 + (p / 100) * 0.16 };
    }
    return GLASS_PRESETS[cfg && cfg.glass] || GLASS_PRESETS.balanced;
  }

  // Inline SVG icon set (stroke = currentColor, so themes just work).
  var ICONS = {
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.48 12.83 17 22l-5-3-5 3 1.52-9.17"/></svg>',
    zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>'
  };

  var CSS = [
    '.tpq-card{box-sizing:border-box;display:flex;flex-direction:column;width:100%;max-width:400px;max-height:min(560px,74vh);border-radius:12px;overflow:hidden;',
    'background:rgba(28,27,25,.82);',
    '-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);',
    'border:1px solid rgba(245,241,221,.22);',
    '--tpq-ok:#b9cfa2;--tpq-bad:#dc9a85;--tpq-perfect:#f5f1dd;--tpq-good:#b9cfa2;--tpq-okay:#d8d3bb;--tpq-low:#8a8578;',
    'color:#f5f1dd;font:14.5px/1.55 KinvtPoppins,Poppins,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;',
    'animation:tpqIn .28s cubic-bezier(.2,.9,.3,1.15) both}',
    '@keyframes tpqIn{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}',
    '.tpq-light{background:rgba(245,241,221,.94);color:#1c1b19;',
    '--tpq-ok:#5d7a45;--tpq-bad:#b4573c;--tpq-perfect:#1c1b19;--tpq-good:#5d7a45;--tpq-okay:#6b675a;--tpq-low:#8a8578;',
    'border-color:rgba(28,27,25,.28)}',
    '.tpq-bar{height:4px;background:rgba(245,241,221,.14);flex:none}',
    '.tpq-bar-fill{height:100%;width:100%;background:#f5f1dd;transition:width linear}',
    '.tpq-head{display:flex;align-items:center;gap:8px;padding:12px 14px 8px;flex:none}',
    '.tpq-title{font-size:13px;font-weight:700;letter-spacing:.3px;display:flex;align-items:center;gap:6px;min-width:0}',
    '.tpq-title .tpq-ico{width:15px;height:15px;flex:none;color:#f5f1dd;opacity:.8}',
    '.tpq-title .tpq-ico svg{display:block;width:100%;height:100%}',
    '.tpq-cat{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.tpq-meta{margin-left:auto;font-size:11.5px;opacity:.65;white-space:nowrap}',
    '.tpq-x{border:0;background:transparent;color:inherit;cursor:pointer;opacity:.65;padding:5px 6px;border-radius:7px;flex:none}',
    '.tpq-x svg{display:block;width:15px;height:15px}',
    '.tpq-x:hover{opacity:1;background:rgba(245,241,221,.18)}',
    '.tpq-body{padding:4px 14px 14px;overflow-y:auto;flex:1 1 auto}',
    '.tpq-question{font-size:15.5px;font-weight:600;margin:6px 0 10px}',
    '.tpq-opt{display:block;width:100%;text-align:left;background:rgba(245,241,221,.07);border:1px solid rgba(245,241,221,.20);color:inherit;',
    'border-radius:9px;padding:9px 12px;margin:7px 0;cursor:pointer;font:inherit;',
    'transition:background .16s,border-color .16s,transform .1s}',
    '.tpq-opt .tpq-letter{display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;',
    'background:rgba(245,241,221,.20);color:#f5f1dd;font-size:11.5px;font-weight:700;margin-right:8px;flex:none}',
    '.tpq-opt:hover{background:rgba(245,241,221,.14);border-color:rgba(245,241,221,.45);transform:translateY(-1px)}',
    '.tpq-opt:disabled{cursor:default}',
    '.tpq-opt:disabled:not(.tpq-good):not(.tpq-bad):hover{background:rgba(245,241,221,.07);border-color:rgba(245,241,221,.20);transform:none}',
    '.tpq-opt:disabled:hover{transform:none}',
    '.tpq-opt.tpq-good{background:rgba(185,207,162,.26);border-color:rgba(185,207,162,.85)}',
    '.tpq-opt.tpq-bad{background:rgba(220,154,133,.22);border-color:rgba(220,154,133,.85)}',
    '.tpq-opt.tpq-dim{opacity:.4}',
    '.tpq-feedback{margin-top:10px;border-radius:9px;padding:10px 12px;background:rgba(245,241,221,.08);',
    'border:1px solid rgba(245,241,221,.22);font-size:13.5px;display:none}',
    '.tpq-feedback.tpq-show{display:block;animation:tpqFade .2s ease both}',
    '@keyframes tpqFade{from{opacity:0}to{opacity:1}}',
    '.tpq-feedback .tpq-verd{font-weight:700;display:flex;align-items:center;gap:7px;margin-bottom:4px}',
    '.tpq-feedback .tpq-verd svg{width:16px;height:16px;flex:none}',
    '.tpq-feedback .tpq-expl{opacity:.85}',
    '.tpq-next{margin-top:12px;width:100%;border:0;border-radius:9px;padding:10px;font:inherit;font-weight:700;cursor:pointer;',
    'background:#f5f1dd;color:#1c1b19;display:none;transition:background .15s}',
    '.tpq-next.tpq-show{display:block}',
    '.tpq-next:hover{background:#ffffff}',
    '.tpq-sum{text-align:center;padding:14px 4px 8px}',
    '.tpq-sum .tpq-status{width:44px;height:44px;margin:0 auto 6px}',
    '.tpq-sum .tpq-status svg{display:block;width:100%;height:100%}',
    '.tpq-sum .tpq-score{font-size:22px;font-weight:800;margin:6px 0 2px}',
    '.tpq-sum .tpq-msg{opacity:.8;font-size:13.5px;margin-bottom:12px}',
    '.tpq-sum .tpq-hint{font-size:11.5px;opacity:.55;margin-top:10px}',
    '.tpq-sum .tpq-next{display:block}',
    '.tpq-light .tpq-opt{background:rgba(28,27,25,.05);border-color:rgba(28,27,25,.20)}',
    '.tpq-light .tpq-opt:hover{background:rgba(28,27,25,.10);border-color:rgba(28,27,25,.45)}',
    '.tpq-light .tpq-opt:disabled:not(.tpq-good):not(.tpq-bad):hover{background:rgba(28,27,25,.05);border-color:rgba(28,27,25,.20);transform:none}',
    '.tpq-light .tpq-opt .tpq-letter{background:rgba(28,27,25,.12);color:#1c1b19}',
    '.tpq-light .tpq-opt.tpq-good{background:rgba(93,122,69,.18);border-color:#5d7a45}',
    '.tpq-light .tpq-opt.tpq-bad{background:rgba(180,87,60,.16);border-color:#b4573c}',
    '.tpq-light .tpq-feedback{background:rgba(28,27,25,.06);border-color:rgba(28,27,25,.22)}',
    '.tpq-light .tpq-x:hover{background:rgba(28,27,25,.12)}',
    '.tpq-light .tpq-bar{background:rgba(28,27,25,.12)}',
    '.tpq-light .tpq-bar-fill{background:#1c1b19}',
    '.tpq-light .tpq-next{background:#1c1b19;color:#f5f1dd}',
    '.tpq-light .tpq-next:hover{background:#33312d}'
  ].join('');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function resolveTheme(theme) {
    if (theme === 'light') return 'tpq-light';
    if (theme === 'auto') {
      try {
        return (global.matchMedia && global.matchMedia('(prefers-color-scheme: light)').matches) ? 'tpq-light' : '';
      } catch (e) { return ''; }
    }
    return '';
  }

  function addStyles(container, css) {
    // `container` is the card's own wrapper div — inside a ShadowRoot when
    // rendered via overlay.js, or directly in the page when rendered via
    // quiz-window.js. `container.shadowRoot` only exists on an element that
    // is ITSELF a shadow host (attachShadow was called on it), which
    // `container` never is here — it's a plain div living *inside* the
    // shadow tree. Checking that always came back falsy, so styles were
    // silently attached to the outer page's document instead, which shadow
    // DOM encapsulation blocks from ever reaching the card. getRootNode()
    // correctly returns the ShadowRoot (or the Document, if there is none)
    // regardless of how deep `container` sits inside it.
    var root = container.getRootNode ? container.getRootNode() : document;
    try {
      if (typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        root.adoptedStyleSheets = (root.adoptedStyleSheets || []).concat([sheet]);
        return;
      }
    } catch (e) { /* fall back to <style> */ }
    var style = el('style');
    style.textContent = css;
    if (root === document) document.head.appendChild(style);
    else root.appendChild(style);
  }

  // @font-face is ignored inside a shadow root — the rule has to live in the
  // host document for the font to resolve for shadow content. So this always
  // targets `document`, even when the card itself renders in a shadow root.
  // Only an @font-face declaration is added (no selectors), and the family is
  // namespaced, so it cannot restyle or collide with anything on the page.
  // Purely cosmetic: any failure here just means the fallback stack is used.
  function ensureFontFace() {
    try {
      if (document.getElementById('__tpq_font__')) return;
      var api = (typeof browser !== 'undefined' && browser) ? browser
              : (typeof chrome !== 'undefined' ? chrome : null);
      if (!api || !api.runtime || typeof api.runtime.getURL !== 'function') return;

      var css = [400, 600, 700].map(function (w) {
        return "@font-face{font-family:'KinvtPoppins';font-style:normal;font-weight:" + w +
               ";font-display:swap;src:url(" + api.runtime.getURL('fonts/poppins-' + w + '.woff2') +
               ") format('woff2');}";
      }).join('');

      var style = document.createElement('style');
      style.id = '__tpq_font__';
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    } catch (e) { /* cosmetic only — never block the card on it */ }
  }

  function create(container, cfg) {
    cfg = cfg || {};
    var questions = (cfg.questions || []).slice();
    var durationMs = Math.max(10, cfg.durationSec | 0 || 45) * 1000;
    var themeCls = resolveTheme(cfg.theme);

    if (!questions.length) return null;

    ensureFontFace();
    addStyles(container, CSS);

    var idx = Math.max(0, Math.min(cfg.startIndex | 0, questions.length - 1));
    var score = Math.max(0, cfg.startScore | 0);
    var answered = false;
    var finished = false;
    var closeTimer = null;

    container.innerHTML =
      '<div class="tpq-card ' + themeCls + '">' +
        '<div class="tpq-bar"><div class="tpq-bar-fill"></div></div>' +
        '<div class="tpq-head">' +
          '<div class="tpq-title"><span class="tpq-ico">' + ICONS.pen + '</span><span class="tpq-cat"></span></div>' +
          '<div class="tpq-meta"></div>' +
          '<button type="button" class="tpq-x" aria-label="Close quiz">' + ICONS.x + '</button>' +
        '</div>' +
        '<div class="tpq-body">' +
          '<div class="tpq-question"></div>' +
          '<div class="tpq-options"></div>' +
          '<div class="tpq-feedback"><span class="tpq-verd"></span><span class="tpq-expl"></span></div>' +
          '<button type="button" class="tpq-next"></button>' +
        '</div>' +
      '</div>';

    var card   = container.querySelector('.tpq-card');
    var fill   = container.querySelector('.tpq-bar-fill');

    /* ---- apply the glass & transparency setting (inline overrides) ---- */
    var gv = glassVals(cfg);
    var isLight = themeCls === 'tpq-light';
    // These inline values override the stylesheet, so they must carry the
    // same palette — the recolour is invisible at runtime otherwise.
    card.style.background = 'rgba(' + (isLight ? '245,241,221' : '28,27,25') + ',' + gv.o.toFixed(2) + ')';
    card.style.webkitBackdropFilter = 'blur(' + gv.blur + 'px)';
    card.style.backdropFilter = 'blur(' + gv.blur + 'px)';
    card.style.borderColor = 'rgba(' + (isLight ? '28,27,25' : '245,241,221') + ',' + gv.border.toFixed(2) + ')';
    var title  = container.querySelector('.tpq-cat');
    var meta   = container.querySelector('.tpq-meta');
    var body   = container.querySelector('.tpq-body');
    var qEl    = container.querySelector('.tpq-question');
    var optsEl = container.querySelector('.tpq-options');
    var fbEl   = container.querySelector('.tpq-feedback');
    var fbVerd = container.querySelector('.tpq-verd');
    var fbExpl = container.querySelector('.tpq-expl');
    var nextEl = container.querySelector('.tpq-next');
    var xEl    = container.querySelector('.tpq-x');

    title.textContent = cfg.title || 'Quiz';
    if (typeof cfg.title === 'string' && cfg.title.length > 34) {
      title.title = cfg.title; // full text on hover
    }

    /* ---- countdown (one CSS transition + one timeout — no loops) ---- */
    function startCountdown() {
      if (closeTimer) clearTimeout(closeTimer);
      fill.style.transition = 'none';
      fill.style.width = '100%';
      void fill.offsetWidth; // force reflow so the transition restarts
      fill.style.transition = 'width ' + durationMs + 'ms linear';
      fill.style.width = '0%';
      closeTimer = setTimeout(function () { close(); }, durationMs);
    }

    function stopCountdown() {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    }

    /* ---- rendering ---- */
    function renderQuestion() {
      var q = questions[idx];
      answered = false;
      qEl.textContent = q.question;
      meta.textContent = 'Q ' + (idx + 1) + '/' + questions.length + ' · tap to pause';
      optsEl.innerHTML = '';
      fbEl.classList.remove('tpq-show');
      nextEl.classList.remove('tpq-show');
      nextEl.textContent = (idx + 1 < questions.length) ? 'Next →' : 'Finish';

      q.options.forEach(function (opt, i) {
        var b = el('button', 'tpq-opt');
        b.type = 'button';
        b.setAttribute('data-i', String(i));
        b.setAttribute('aria-label', LETTERS[i] + '. ' + opt);
        b.appendChild(el('span', 'tpq-letter', LETTERS[i]));
        b.appendChild(el('span', '', opt));
        optsEl.appendChild(b);
      });
    }

    function renderSummary() {
      finished = true;
      stopCountdown();
      fill.style.transition = 'none';
      fill.style.width = '0%';

      var pct = questions.length ? Math.round((score / questions.length) * 100) : 0;
      var icon, color, msg;
      if (pct === 100)      { icon = ICONS.trophy; color = 'var(--tpq-perfect)'; msg = 'Perfect! Exam-ready energy.'; }
      else if (pct >= 60)   { icon = ICONS.check;  color = 'var(--tpq-good)';    msg = 'Solid attempt — keep the streak going!'; }
      else if (pct > 0)     { icon = ICONS.zap;    color = 'var(--tpq-okay)';    msg = 'Good try — every question sharpens you.'; }
      else                  { icon = ICONS.book;   color = 'var(--tpq-low)';     msg = 'Tough set — revise and try the next popup!'; }

      body.innerHTML =
        '<div class="tpq-sum">' +
          '<div class="tpq-status" style="color:' + color + '">' + icon + '</div>' +
          '<div class="tpq-score">' + score + ' / ' + questions.length + '</div>' +
          '<div class="tpq-msg">' + msg + '</div>' +
          '<button type="button" class="tpq-next tpq-show">Done</button>' +
          '<div class="tpq-hint">Tip: click the extension icon in the toolbar to browse the full library.</div>' +
        '</div>';
      if (typeof cfg.onFinish === 'function') {
        try { cfg.onFinish(score, questions.length); } catch (e) { /* noop */ }
      }
    }

    /* ---- answering ---- */
    function pick(i) {
      if (answered || finished) return;
      answered = true;
      startCountdown(); // interaction resets the auto-close timer

      var q = questions[idx];
      var correct = (i === q.answer);
      if (correct) score++;

      var buttons = optsEl.querySelectorAll('.tpq-opt');
      buttons.forEach(function (b, bi) {
        b.disabled = true;
        if (bi === q.answer) b.classList.add('tpq-good');
        else if (bi === i)   b.classList.add('tpq-bad');
        else                 b.classList.add('tpq-dim');
      });

      fbVerd.style.color = correct ? 'var(--tpq-ok)' : 'var(--tpq-bad)';
      fbVerd.innerHTML = (correct ? ICONS.check : ICONS.x) +
        (correct ? 'Correct!' : 'Not quite — correct answer: ' + LETTERS[q.answer] + '. ' + q.options[q.answer]);
      fbExpl.textContent = q.explanation || '';
      fbEl.classList.add('tpq-show');
      // Per-answer, so callers can track which specific questions were missed.
      // onFinish only carries a score, which cannot drive review.
      if (typeof cfg.onAnswer === 'function') {
        try { cfg.onAnswer(q, correct); } catch (e) { /* noop */ }
      }
      reportProgress();

      var isLast = (idx + 1 >= questions.length);
      if (isLast && cfg.skipSummary) {
        // Nothing left to advance to — give the explanation time to be read,
        // then go. Showing a button that only says "Done" is a dead click.
        stopCountdown();
        closeTimer = setTimeout(finishQuietly, 2600);
      } else {
        nextEl.classList.add('tpq-show');
      }
    }

    function reportProgress() {
      if (typeof cfg.onProgress === 'function') {
        try { cfg.onProgress(idx, score); } catch (e) { /* noop */ }
      }
    }

    function next() {
      if (!answered || finished) return;
      if (idx + 1 < questions.length) { idx++; renderQuestion(); startCountdown(); reportProgress(); }
      else if (cfg.skipSummary) { finishQuietly(); }
      else { renderSummary(); }
    }

    // Answer-and-done: no summary card, no Done button to dismiss. The last
    // answer's feedback stays up long enough to read, then the card leaves.
    function finishQuietly() {
      if (finished) return;
      finished = true;
      stopCountdown();
      if (typeof cfg.onFinish === 'function') {
        try { cfg.onFinish(score, questions.length); } catch (e) { /* noop */ }
      }
      close();
    }

    function close() {
      if (finished && body.querySelector('.tpq-sum')) {
        // summary Done button → same close path
      }
      stopCountdown();
      cleanupListeners();
      if (typeof cfg.onClose === 'function') {
        try { cfg.onClose(); } catch (e) { /* noop */ }
      }
    }

    /* ---- events (delegated — a single listener) ---- */
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (finished) return;
      if (!answered) {
        var n = parseInt(e.key, 10);
        if (n >= 1 && n <= questions[idx].options.length) { pick(n - 1); return; }
      } else if (e.key === 'Enter') {
        next();
      }
    }

    function onClick(e) {
      var t = e.target;
      while (t && t !== container) {
        if (t.classList && t.classList.contains('tpq-opt') && !t.disabled) {
          pick(parseInt(t.getAttribute('data-i'), 10));
          return;
        }
        if (t.classList && t.classList.contains('tpq-next') && t.classList.contains('tpq-show')) {
          if (body.querySelector('.tpq-sum')) { close(); } else { next(); }
          return;
        }
        if (t.classList && t.classList.contains('tpq-x')) { close(); return; }
        t = t.parentNode;
      }
    }

    container.addEventListener('click', onClick);
    var doc = container.ownerDocument || document;
    doc.addEventListener('keydown', onKey, true);

    function cleanupListeners() {
      container.removeEventListener('click', onClick);
      doc.removeEventListener('keydown', onKey, true);
    }

    /* ---- go ---- */
    renderQuestion();
    startCountdown();

    return { close: close, card: card };
  }

  global.TPQ_UI = { create: create };
})(typeof window !== 'undefined' ? window : this);

