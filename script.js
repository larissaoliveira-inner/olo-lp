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

  /* Whisper headlines.

     Split into per-word spans so each can fade up out of a blur on its own
     delay. The sentence stays a single text node in the markup, so with JS
     off it simply reads as a headline — nothing to un-hide. Runs before
     initReveals, which is what actually adds `.is-in`. */

  function initWhisper() {
    toArray(document.querySelectorAll('[data-reveal="whisper"]')).forEach(function (el) {
      var words = el.textContent.trim().split(/\s+/);
      var frag = document.createDocumentFragment();

      words.forEach(function (word, i) {
        var span = document.createElement('span');
        span.className = 'w';
        span.style.setProperty('--i', i);
        span.textContent = word;
        frag.appendChild(span);
        // A real space between words, outside the spans, so the line still
        // wraps and copies as ordinary prose.
        if (i < words.length - 1) frag.appendChild(document.createTextNode(' '));
      });

      el.textContent = '';
      el.appendChild(frag);
    });
  }

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
     Stroke-draw headers

     The surface headers draw themselves on: each character's outline strokes
     in, then a solid fill wipes across the word. Every word becomes its own
     inline SVG, sized to its own bbox and dropped onto the baseline, so the
     header still breaks lines wherever the browser would have broken them.
     The SVG text inherits the h3's font, so nothing about the typography
     changes — only the paint.

     Falls back to the plain text already in the markup when JS is off, motion
     is reduced, or the browser can't measure SVG text.
     ------------------------------------------------------------------------ */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* Longer than any single glyph contour at this size — the dash pattern is
     what turns a static outline into something that can be drawn. */
  var SH_DASH = 220;
  var SH_STROKE_W = 1;
  var SH_DRAW = 700;        // ms a character's outline spends drawing on
  var SH_FILL_DELAY = 120;  // ms between a word's draw and its fill
  var SH_EASE = 'cubic-bezier(.25,.46,.45,.94)';

  /* The wipe, as clip insets on the fill text. Percentages resolve against the
     glyph box, so one pair of keyframes serves every word. */
  var SH_CLIP_OUT = 'inset(0% 100% 0% 0%)';
  var SH_CLIP_IN = 'inset(0% 0% 0% 0%)';

  function shText(word, className) {
    var text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('class', className);
    text.setAttribute('x', 0);
    text.setAttribute('y', 0);

    // One tspan per character: the unit the stagger animates.
    word.split('').forEach(function (ch) {
      var tspan = document.createElementNS(SVG_NS, 'tspan');
      tspan.textContent = ch;
      text.appendChild(tspan);
    });

    return text;
  }

  function shBuildWord(word, firstIndex) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'sh-word');
    svg.setAttribute('aria-hidden', 'true');

    // Stroke first, fill over it: the fill covers the inner half of the
    // outline, leaving the accent as a hairline around solid letters.
    var stroke = shText(word, 'sh-stroke');
    stroke.setAttribute('stroke-width', SH_STROKE_W);
    var fill = shText(word, 'sh-fill');
    svg.appendChild(stroke);
    svg.appendChild(fill);

    return { svg: svg, fill: fill, stroke: stroke, chars: word.length, first: firstIndex };
  }

  /* Replaces el's text with the SVG words and returns them, or null if the
     browser gave us nothing measurable — in which case the text is restored. */
  function shEnhance(el) {
    var source = el.textContent.trim().replace(/\s+/g, ' ');
    if (!source) return null;

    var words = source.split(' ');
    var frag = document.createDocumentFragment();
    var parts = [];
    var index = 0;

    words.forEach(function (word, i) {
      var part = shBuildWord(word, index);
      index += word.length;
      parts.push(part);
      frag.appendChild(part.svg);
      // A real space between the SVGs, outside them, so the header still
      // wraps between words.
      if (i < words.length - 1) frag.appendChild(document.createTextNode(' '));
    });

    el.setAttribute('aria-label', source);
    el.textContent = '';
    el.appendChild(frag);

    // Measure every word in one pass, before any of the writes below, so the
    // reads don't force a layout per word.
    var boxes = parts.map(function (part) {
      try {
        return part.stroke.getBBox();
      } catch (e) {
        return null;
      }
    });

    var unmeasured = boxes.some(function (box) { return !box || !box.width; });
    if (unmeasured) {
      el.removeAttribute('aria-label');
      el.textContent = source;
      return null;
    }

    parts.forEach(function (part, i) {
      var box = boxes[i];
      var x = box.x - SH_STROKE_W;
      var y = box.y - SH_STROKE_W;
      var w = box.width + SH_STROKE_W * 2;
      var h = box.height + SH_STROKE_W * 2;

      // 1:1 user units to px, so the word occupies exactly the space the
      // glyphs did.
      part.svg.setAttribute('viewBox', x + ' ' + y + ' ' + w + ' ' + h);
      part.svg.style.width = w + 'px';
      part.svg.style.height = h + 'px';
      // Collapse the SVG's margin box to nothing, centred on the glyph
      // baseline (y = 0 in the box's own space). Its bottom margin edge is
      // what `vertical-align: baseline` puts on the line, so the word lands
      // exactly where the text did — and because the box measures zero, the
      // line height stays the strut's, not the taller SVG's. The glyphs
      // themselves still paint, via `overflow: visible`.
      part.svg.style.marginTop = y + 'px';
      part.svg.style.marginBottom = -(y + h) + 'px';
    });

    return parts;
  }

  function shArm(parts) {
    parts.forEach(function (part) {
      toArray(part.stroke.childNodes).forEach(function (tspan) {
        tspan.style.strokeDasharray = SH_DASH;
        tspan.style.strokeDashoffset = SH_DASH;
      });
      part.fill.style.clipPath = SH_CLIP_OUT;
    });
  }

  function shPlay(parts, total, canAnimate) {
    // Tightens the per-character delay on long headers, so a five-word one and
    // a fifteen-word one both land in roughly the same couple of seconds.
    var stagger = Math.min(34, Math.max(18, 1400 / total));

    parts.forEach(function (part) {
      var start = part.first * stagger;

      toArray(part.stroke.childNodes).forEach(function (tspan, i) {
        if (!canAnimate) {
          tspan.style.strokeDashoffset = 0;
          return;
        }
        tspan.animate(
          [{ strokeDashoffset: SH_DASH }, { strokeDashoffset: 0 }],
          {
            duration: SH_DRAW,
            delay: start + i * stagger,
            easing: SH_EASE,
            fill: 'forwards'
          }
        );
      });

      if (!canAnimate) {
        part.fill.style.clipPath = SH_CLIP_IN;
        return;
      }

      // Each word floods once its own first letter is through, over about as
      // long as its letters took — so the fills read as one sweep across the
      // line rather than a run of pops.
      part.fill.animate(
        [{ clipPath: SH_CLIP_OUT }, { clipPath: SH_CLIP_IN }],
        {
          duration: Math.max(300, part.chars * stagger + 300),
          delay: start + SH_DRAW + SH_FILL_DELAY,
          easing: 'cubic-bezier(.4, 0, .2, 1)',
          fill: 'forwards'
        }
      );
    });
  }

  function initStrokeHeads() {
    var nodes = toArray(document.querySelectorAll('.surface-h'));
    if (!nodes.length || reducedMotion) return;
    // Everything downstream is derived from measured glyph boxes.
    if (typeof document.createElementNS(SVG_NS, 'text').getBBox !== 'function') return;

    var canAnimate = typeof document.createElement('div').animate === 'function';

    var build = function () {
      var heads = [];

      nodes.forEach(function (el) {
        // Plain single-text-node headers only; anything richer is left alone.
        if (el.childNodes.length !== 1 || el.firstChild.nodeType !== 3) return;

        var parts = shEnhance(el);
        if (!parts) return;

        var total = parts.reduce(function (n, part) { return n + part.chars; }, 0);
        shArm(parts);

        var head = {
          el: el,
          played: false,
          play: function () {
            if (head.played) return;
            head.played = true;
            // A beat behind the row's own fade-up, so the two don't collide.
            setTimeout(function () { shPlay(parts, total, canAnimate); }, 180);
          }
        };

        heads.push(head);
      });

      if (!heads.length) return;

      var playAll = function () {
        heads.forEach(function (head) { head.play(); });
      };

      if (!('IntersectionObserver' in window)) {
        playAll();
        return;
      }

      var observerFired = false;
      var io = new IntersectionObserver(function (entries) {
        observerFired = true;
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          io.unobserve(entry.target);
          heads.forEach(function (head) {
            if (head.el === entry.target) head.play();
          });
        });
      }, { threshold: 0.35, rootMargin: '0px 0px -8% 0px' });

      heads.forEach(function (head) { io.observe(head.el); });

      // Same safety net as initReveals — an armed header that never plays is
      // an invisible one, so don't leave that to chance.
      setTimeout(function () {
        if (!observerFired) playAll();
      }, 4000);
    };

    // Measure against the real webfont rather than the fallback: every word's
    // box and baseline offset are derived from those bboxes.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(build, build);
    } else {
      build();
    }
  }

  /* ------------------------------------------------------------------------
     Scrambled headline

     Characters within a radius of the pointer dissolve into punctuation and
     resolve back, hardest right under the cursor and tapering to nothing at
     the edge of the radius. The text is split into per-character spans, each
     locked to the width it measured at — the headline is set in a
     proportional face, so without that the line would jitter every time a
     'W' became a '.'.

     No pointer, no JS, or reduced motion and the headline is just a headline.
     ------------------------------------------------------------------------ */

  var SC_RADIUS = 110;   // px from the cursor within which characters react
  var SC_DURATION = 1.2; // s a character directly under the cursor scrambles
  var SC_STEP = 52;      // ms between glyph swaps while scrambling
  var SC_CHARS = '.:';

  /* Wraps every non-space character in its own span, leaving the whitespace
     as text nodes so the headline still breaks lines where it did. */
  function scSplit(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    var chars = [];
    var node;

    while ((node = walker.nextNode())) textNodes.push(node);

    textNodes.forEach(function (text) {
      var frag = document.createDocumentFragment();

      text.nodeValue.split('').forEach(function (ch) {
        if (!ch.trim()) {
          frag.appendChild(document.createTextNode(ch));
          return;
        }
        var span = document.createElement('span');
        span.className = 'sc-char';
        span.textContent = ch;
        frag.appendChild(span);
        chars.push({ el: span, ch: ch });
      });

      text.parentNode.replaceChild(frag, text);
    });

    return chars;
  }

  function initScramble() {
    var roots = toArray(document.querySelectorAll('[data-scramble]'));
    if (!roots.length || reducedMotion) return;

    roots.forEach(function (root) {
      var chars = scSplit(root);
      if (!chars.length) return;

      var active = [];
      var frame = 0;

      // Measured once, against the real glyphs, then frozen: the centres are
      // what the pointer is tested against and the widths are what stop the
      // line from reflowing mid-scramble.
      var measure = function () {
        var base = root.getBoundingClientRect();
        chars.forEach(function (c) {
          c.el.style.width = '';
          var r = c.el.getBoundingClientRect();
          c.x = r.left + r.width / 2 - base.left;
          c.y = r.top + r.height / 2 - base.top;
          c.el.style.width = r.width + 'px';
        });
      };

      var tick = function (now) {
        for (var i = active.length - 1; i >= 0; i--) {
          var c = active[i];
          if (now >= c.until) {
            c.el.textContent = c.ch;
            c.on = false;
            active.splice(i, 1);
          } else if (now >= c.next) {
            c.el.textContent = SC_CHARS.charAt(Math.floor(Math.random() * SC_CHARS.length));
            c.next = now + SC_STEP;
          }
        }
        frame = active.length ? requestAnimationFrame(tick) : 0;
      };

      root.addEventListener('pointermove', function (e) {
        var base = root.getBoundingClientRect();
        var now = performance.now();
        var woke = false;

        chars.forEach(function (c) {
          var dx = e.clientX - (base.left + c.x);
          var dy = e.clientY - (base.top + c.y);
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= SC_RADIUS) return;

          // Closer to the cursor, longer to settle. Re-entering a character
          // that's still going just pushes its finish line back out.
          c.until = now + SC_DURATION * 1000 * (1 - dist / SC_RADIUS);
          if (!c.on) {
            c.on = true;
            c.next = 0;
            active.push(c);
            woke = true;
          }
        });

        if (woke && !frame) frame = requestAnimationFrame(tick);
      });

      addEventListener('resize', measure);
      measure();
      // The widths come from the webfont's metrics, so they're only right once
      // it's actually the font being measured.
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure, measure);
    });
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
    initWhisper();
    initStrokeHeads();
    initScramble();
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
