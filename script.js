/* olo security — landing page behaviour
   Independent widgets: scroll reveals, the device demos, the agent terminal,
   the FAQ, the nav theme. Each is defensive: if its markup is absent, it
   no-ops. */

(function () {
  'use strict';

  var reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var toArray = function (nodeList) {
    return Array.prototype.slice.call(nodeList);
  };

  /* ------------------------------------------------------------------------
     Scroll reveals
     ------------------------------------------------------------------------ */

  function initReveals() {
    var nodes = toArray(document.querySelectorAll('[data-reveal]'));
    if (!nodes.length) return;

    var show = function (el) { el.classList.add('is-in'); };

    if (reducedMotion || !('IntersectionObserver' in window)) {
      nodes.forEach(show);
      return;
    }

    var observerFired = false;
    var io = new IntersectionObserver(function (entries) {
      observerFired = true;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        show(entry.target);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.2, rootMargin: '0px 0px -8% 0px' });

    nodes.forEach(function (node) { io.observe(node); });

    // Safety net for the case where the observer never reports at all.
    // Revealing unconditionally here would skip every below-the-fold animation.
    setTimeout(function () {
      if (!observerFired) nodes.forEach(show);
    }, 4000);
  }

  /* ------------------------------------------------------------------------
     The device demos — browser tabs and desktop apps

     Segment text lives in the markup (so the page still reads with JS
     disabled); this truncates it to a character count, underlines each flagged
     span the moment it is complete, then swaps in its token. Once a span is
     tokenized its real text is deleted from the DOM, so nothing sensitive is
     left behind to read or copy.
     ------------------------------------------------------------------------ */

  var TYPE_MS = 24;
  // Characters the caret runs past a span before the value becomes a token —
  // the detection reads as keeping pace with typing rather than a later sweep.
  var LAG = 14;
  var HOLD_MS = 4200;
  var ROTATE_MS = 5000;

  function makeTyper(box) {
    var segs = toArray(box.querySelectorAll('.seg')).map(function (el) {
      var textEl = el.querySelector('.seg-t');
      return {
        el: el,
        textEl: textEl,
        full: textEl ? textEl.textContent : '',
        flag: el.classList.contains('seg--flag')
      };
    });
    if (!segs.length) return null;

    var total = segs.reduce(function (n, seg) { return n + seg.full.length; }, 0);
    var caret = box.querySelector('.caret');
    var panel = box.closest ? box.closest('.mock-panel') : null;
    var status = panel ? panel.querySelector('.mock-status') : null;
    var doneText = box.getAttribute('data-done') || 'clean';

    var timers = [];
    var interval = null;

    function paint(chars) {
      var consumed = 0;
      segs.forEach(function (seg) {
        if (!seg.textEl) return;
        var from = consumed;
        var to = consumed + seg.full.length;
        consumed = to;
        var shown = Math.max(0, Math.min(seg.full.length, chars - from));

        if (!seg.flag) {
          var plain = seg.full.slice(0, shown);
          if (seg.textEl.textContent !== plain) seg.textEl.textContent = plain;
          return;
        }

        // Past the span plus the lag: swap in the token and delete the value.
        if (chars >= to + LAG) {
          if (!seg.el.classList.contains('is-tokenized')) {
            seg.el.classList.add('is-tokenized');
            seg.textEl.textContent = '';
          }
          return;
        }

        seg.el.classList.remove('is-tokenized');
        seg.el.classList.toggle('is-detected', shown === seg.full.length);
        var real = seg.full.slice(0, shown);
        if (seg.textEl.textContent !== real) seg.textEl.textContent = real;
      });

      if (caret) caret.classList.toggle('is-hidden', chars >= total);
    }

    function reset() {
      segs.forEach(function (seg) {
        seg.el.classList.remove('is-detected', 'is-tokenized');
        if (seg.textEl) seg.textEl.textContent = '';
      });
      if (status) status.textContent = 'reading on device…';
      paint(0);
    }

    function settle() {
      segs.forEach(function (seg) {
        if (!seg.textEl) return;
        seg.el.classList.remove('is-detected');
        if (seg.flag) {
          seg.el.classList.add('is-tokenized');
          seg.textEl.textContent = '';
        } else {
          seg.textEl.textContent = seg.full;
        }
      });
      if (caret) caret.classList.add('is-hidden');
      if (status) status.textContent = doneText;
    }

    function stop() {
      timers.forEach(clearTimeout);
      timers = [];
      clearInterval(interval);
      interval = null;
    }

    function run() {
      stop();
      reset();
      var chars = 0;
      interval = setInterval(function () {
        chars += 1;
        paint(chars);
        if (chars < total + LAG) return;
        clearInterval(interval);
        interval = null;
        if (status) status.textContent = doneText;
        timers.push(setTimeout(run, HOLD_MS));
      }, TYPE_MS);
    }

    return { run: run, stop: stop, settle: settle };
  }

  function initDemos() {
    var mocks = toArray(document.querySelectorAll('[data-demo]'));
    if (!mocks.length) return;
    mocks.forEach(setupMock);
  }

  function setupMock(mock) {
    var panels = toArray(mock.querySelectorAll('.mock-panel'));
    if (!panels.length) return;

    var ids = panels.map(function (p) { return p.id; });

    // The browser's tablist sits inside the window; the desktop dock sits
    // outside it. Match on aria-controls so placement doesn't matter.
    var tabs = toArray(document.querySelectorAll('[role="tab"]')).filter(function (tab) {
      return ids.indexOf(tab.getAttribute('aria-controls')) !== -1;
    });

    var typers = panels.map(function (panel) {
      var box = panel.querySelector('[data-typer]');
      return box ? makeTyper(box) : null;
    });

    var current = 0;
    var started = false;
    var rotateTimer = null;
    var hovering = false;
    var userPicked = false;

    // Park every panel on its redacted end state before anything starts. Only
    // the panel currently animating ever holds a real value in the DOM; the
    // rest hold tokens. (The strings still ship in the HTML source — that is
    // the cost of keeping the demo readable with JS off.)
    typers.forEach(function (typer) { if (typer) typer.settle(); });

    var titleEl = mock.querySelector('.app-title');

    // The desktop window has one title bar for four apps: re-point its brand
    // tokens and title rather than duplicating the bar per panel.
    function applyChrome(i) {
      var app = panels[i].getAttribute('data-app');
      var title = panels[i].getAttribute('data-title');
      if (app) mock.setAttribute('data-app', app);
      if (titleEl && title) titleEl.textContent = title;
    }

    if (reducedMotion) {
      wireTabs();
      return;
    }

    function show(next) {
      if (next === current) return;
      var prev = typers[current];
      if (prev) {
        prev.stop();
        prev.settle();
      }

      current = next;
      applyChrome(next);
      panels.forEach(function (panel, i) {
        if (i === next) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
      });
      tabs.forEach(function (tab, i) {
        var on = i === next;
        tab.classList.toggle('is-on', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
      });

      if (started && typers[next]) typers[next].run();
    }

    function pick(i) {
      userPicked = true;
      stopRotate();
      show(i);
    }

    function wireTabs() {
      tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () { pick(i); });

        // Arrow-key movement is expected of anything with role="tablist".
        tab.addEventListener('keydown', function (event) {
          var step =
            event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 :
            event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 :
            event.key === 'Home' ? -i :
            event.key === 'End' ? tabs.length - 1 - i : 0;
          if (!step) return;
          event.preventDefault();
          var next = (i + step + tabs.length) % tabs.length;
          pick(next);
          tabs[next].focus();
        });
      });
    }

    function stopRotate() {
      clearTimeout(rotateTimer);
      rotateTimer = null;
    }

    // Only the desktop window cycles on its own, and only until the reader
    // takes over by picking an app.
    function scheduleRotate() {
      if (mock.getAttribute('data-demo') !== 'desktop' || userPicked) return;
      stopRotate();
      rotateTimer = setTimeout(function () {
        if (!hovering && !userPicked) show((current + 1) % panels.length);
        scheduleRotate();
      }, ROTATE_MS);
    }

    function start() {
      if (started) return;
      started = true;
      if (typers[current]) typers[current].run();
      scheduleRotate();
    }

    function halt() {
      stopRotate();
      typers.forEach(function (typer) { if (typer) typer.stop(); });
    }

    wireTabs();

    mock.addEventListener('pointerenter', function () { hovering = true; });
    mock.addEventListener('pointerleave', function () { hovering = false; });

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          io.disconnect();
          start();
        });
      }, { threshold: 0.35 });
      io.observe(mock);
    } else {
      start();
    }

    // Don't burn a 24ms interval in a background tab.
    document.addEventListener('visibilitychange', function () {
      if (!started) return;
      if (document.hidden) halt();
      else {
        if (typers[current]) typers[current].run();
        scheduleRotate();
      }
    });
  }

  /* ------------------------------------------------------------------------
     The agent terminal

     Same idea, simpler: type the command, then reveal each output line on its
     own data-at offset. Nothing here is ever un-redacted — the payload line
     ships as tokens in the markup.
     ------------------------------------------------------------------------ */

  function initTerminal() {
    var box = document.querySelector('[data-term]');
    if (!box) return;

    var cmd = box.querySelector('.term-cmd');
    var lines = toArray(box.querySelectorAll('.term-line'));
    if (!cmd || !lines.length) return;

    var full = cmd.textContent;
    var caret = box.querySelector('.caret');
    var CHAR_MS = 22;
    var LEAD = 260;

    var last = lines.reduce(function (n, line) {
      return Math.max(n, Number(line.getAttribute('data-at')) || 0);
    }, 0);

    var timers = [];
    var interval = null;
    var started = false;

    function settle() {
      cmd.textContent = full;
      lines.forEach(function (line) { line.classList.add('is-on'); });
      if (caret) caret.classList.add('is-hidden');
    }

    function stop() {
      timers.forEach(clearTimeout);
      timers = [];
      clearInterval(interval);
      interval = null;
    }

    function run() {
      stop();
      var chars = 0;
      cmd.textContent = '';
      lines.forEach(function (line) { line.classList.remove('is-on'); });
      if (caret) caret.classList.remove('is-hidden');

      interval = setInterval(function () {
        chars += 1;
        cmd.textContent = full.slice(0, chars);
        if (chars < full.length) return;
        clearInterval(interval);
        interval = null;
        if (caret) caret.classList.add('is-hidden');

        lines.forEach(function (line) {
          var at = LEAD + (Number(line.getAttribute('data-at')) || 0);
          timers.push(setTimeout(function () { line.classList.add('is-on'); }, at));
        });
        timers.push(setTimeout(run, LEAD + last + HOLD_MS));
      }, CHAR_MS);
    }

    if (reducedMotion) {
      settle();
      return;
    }

    function start() {
      if (started) return;
      started = true;
      run();
    }

    if ('IntersectionObserver' in window) {
      var to = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          to.disconnect();
          start();
        });
      }, { threshold: 0.35 });
      to.observe(box);
    } else {
      start();
    }

    document.addEventListener('visibilitychange', function () {
      if (!started) return;
      if (document.hidden) stop();
      else run();
    });
  }

  /* ------------------------------------------------------------------------
     FAQ accordion

     max-height is measured from content rather than hardcoded, so long
     answers can't be clipped at narrow widths.
     ------------------------------------------------------------------------ */

  function initFaq() {
    var buttons = toArray(document.querySelectorAll('.faq-q'));
    if (!buttons.length) return;

    var panels = buttons.map(function (btn) {
      return document.getElementById(btn.getAttribute('aria-controls'));
    });
    var openIndex = -1;

    function setOpen(next) {
      openIndex = next;
      buttons.forEach(function (btn, i) {
        var isOpen = i === next;
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        var panel = panels[i];
        if (!panel) return;
        panel.classList.toggle('is-open', isOpen);
        panel.style.maxHeight = isOpen ? panel.scrollHeight + 'px' : '0px';
      });
    }

    buttons.forEach(function (btn, i) {
      btn.addEventListener('click', function () {
        setOpen(openIndex === i ? -1 : i);
      });
    });

    setOpen(0);

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var panel = panels[openIndex];
        if (panel) panel.style.maxHeight = panel.scrollHeight + 'px';
      }, 120);
    });
  }

  /* ------------------------------------------------------------------------
     Nav theme

     The nav is light, but the hero behind it is dark — invert it while the
     hero is under the bar, and swap back once the page scrolls past.
     ------------------------------------------------------------------------ */

  function initNavTheme() {
    var nav = document.querySelector('.nav');
    var hero = document.querySelector('.hero-shell');
    if (!nav || !hero) return;

    var navHeight = nav.offsetHeight || 70;

    function sync() {
      var overlapsNav = hero.getBoundingClientRect().bottom > navHeight;
      nav.classList.toggle('nav--on-dark', overlapsNav);
    }

    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        sync();
        ticking = false;
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () {
      navHeight = nav.offsetHeight || 70;
      sync();
    });
    sync();
  }

  /* --------------------------------------------------------------------- */

  function init() {
    initReveals();
    initDemos();
    initTerminal();
    initFaq();
    initNavTheme();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
