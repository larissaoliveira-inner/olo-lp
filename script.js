/* olo security — landing page behaviour
   Three independent widgets: scroll reveals, the redaction vignette, the FAQ.
   Each is defensive: if its markup is absent, it no-ops. */

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
     The redaction vignette

     Segment text lives in the markup (so it still reads with JS disabled);
     this just truncates it to a character count and toggles the bars.
     ------------------------------------------------------------------------ */

  function initVignette() {
    var root = document.getElementById('vigText');
    var frame = document.getElementById('vignette');
    if (!root || !frame) return;

    var segs = toArray(root.querySelectorAll('.seg')).map(function (el) {
      var textEl = el.querySelector('.seg-t') || el;
      return {
        el: el,
        textEl: textEl,
        full: textEl.textContent,
        flag: el.hasAttribute('data-flag') ? Number(el.getAttribute('data-flag')) : -1
      };
    });
    if (!segs.length) return;

    var total = segs.reduce(function (n, seg) { return n + seg.full.length; }, 0);
    var caret = document.getElementById('vigCaret');
    var caption = document.getElementById('vigCaption');
    var logs = toArray(document.querySelectorAll('.vig-log'));

    var TYPE_MS = 24;
    var REDACT_DELAY = 800;
    var REDACT_STEP = 620;
    var HOLD_MS = 4200;

    var timers = [];
    var interval = null;
    var started = false;

    function render(chars, redacted, captionOn) {
      var consumed = 0;
      segs.forEach(function (seg) {
        var shown = Math.max(0, Math.min(seg.full.length, chars - consumed));
        consumed += seg.full.length;
        seg.textEl.textContent = seg.full.slice(0, shown);
        var isRedacted =
          seg.flag >= 0 && !!redacted[seg.flag] && shown === seg.full.length;
        seg.el.classList.toggle('is-redacted', isRedacted);
      });

      if (caret) caret.classList.toggle('is-hidden', chars >= total);
      logs.forEach(function (log, i) { log.classList.toggle('is-on', !!redacted[i]); });
      if (caption) caption.classList.toggle('is-on', !!captionOn);
    }

    function stop() {
      timers.forEach(clearTimeout);
      timers = [];
      clearInterval(interval);
      interval = null;
    }

    function redactSequence() {
      var redacted = [0, 0, 0];
      redacted.forEach(function (_, i) {
        timers.push(setTimeout(function () {
          redacted[i] = 1;
          render(total, redacted, false);
        }, REDACT_DELAY + i * REDACT_STEP));
      });

      var settled = REDACT_DELAY + redacted.length * REDACT_STEP;
      timers.push(setTimeout(function () {
        render(total, redacted, true);
      }, settled));
      timers.push(setTimeout(runCycle, settled + HOLD_MS));
    }

    function runCycle() {
      stop();
      var chars = 0;
      render(chars, [0, 0, 0], false);
      interval = setInterval(function () {
        chars += 1;
        render(chars, [0, 0, 0], false);
        if (chars < total) return;
        clearInterval(interval);
        interval = null;
        redactSequence();
      }, TYPE_MS);
    }

    function start() {
      if (started) return;
      started = true;
      runCycle();
    }

    if (reducedMotion) {
      render(total, [1, 1, 1], true);
      return;
    }

    if ('IntersectionObserver' in window) {
      var vo = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          vo.disconnect();
          start();
        });
      }, { threshold: 0.35 });
      vo.observe(frame);
    } else {
      start();
    }

    // Don't burn a 24ms interval in a background tab.
    document.addEventListener('visibilitychange', function () {
      if (!started) return;
      if (document.hidden) stop();
      else runCycle();
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
    initVignette();
    initFaq();
    initNavTheme();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
