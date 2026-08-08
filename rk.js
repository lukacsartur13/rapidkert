/* ==========================================================================
   RAPIDKERT — MOTION & INTERACTION LAYER (supporting)
   --------------------------------------------------------------------------
   No animation libraries. Everything is IntersectionObserver + one shared
   rAF scroll loop, so the whole file costs ~7KB and never blocks paint.

   Motion hierarchy (deliberate, enforced here):
     STATIC   — body copy, lists, contact details. Never animated.
     MODERATE — image masks, headline lines, section labels, the drawn
                cross-sections on the inner pages.
     SIGNATURE— none, any more. Phase 2 moved the site's one signature
                moment into rk-ground.js, which owns the homepage's single
                WebGL canvas and its scroll timeline. This file is now
                strictly the supporting layer: navigation, reveals, the
                references lightbox, the quote form and the page wipe.

   Every module is a no-op when `prefers-reduced-motion: reduce` is set or
   when its target element is absent, so this file is safe on any page.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.remove('no-js');

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ------------------------------------------------------------------ */
  /* Shared rAF scroll loop — one listener for the whole page.           */
  /* ------------------------------------------------------------------ */
  var readers = [];
  var ticking = false;

  // try/finally: if any reader throws, the flag must still clear, or every
  // later scroll event is dropped and the page freezes mid-state.
  function runReaders() {
    try {
      for (var i = 0; i < readers.length; i++) readers[i]();
    } finally {
      ticking = false;
    }
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(runReaders);
  }
  function onFrame(fn) {
    readers.push(fn);
    fn();
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  /* A page can arrive already scrolled — a #fragment link, a reload that
     restores position, or a back/forward bfcache restore — and none of those
     emit a scroll event, so the header would sit in its transparent
     over-dark state on top of a light section until the visitor happened to
     scroll. These run the readers SYNCHRONOUSLY rather than through
     onScroll(): requestAnimationFrame does not fire in a tab that is not
     rendering (a background tab, a restored bfcache entry), and the header's
     resting state must never depend on a frame being produced. */
  window.addEventListener('load', runReaders);
  window.addEventListener('pageshow', runReaders);

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ================================================================== */
  /* 01 — TOPOGRAPHY GENERATOR                                          */
  /* ------------------------------------------------------------------ */
  /* Procedural contour lines. Deterministic (seeded) so the composition */
  /* is identical on every load and between server renders.              */
  /* ================================================================== */
  function topo(el) {
    var lines = +el.dataset.lines || 9;
    var seed = +el.dataset.seed || 7;
    var w = 1200, h = +el.dataset.h || 600;

    // Small deterministic PRNG — no Math.random, so contours never jump.
    function rnd() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }

    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">';
    var amps = [], phs = [];
    for (var k = 0; k < 3; k++) { amps.push(18 + rnd() * 46); phs.push(rnd() * 6.28); }

    for (var i = 0; i < lines; i++) {
      // Contours bunch toward the middle, like a real terrain survey.
      var t = i / (lines - 1);
      var base = h * (0.10 + 0.80 * t);
      var squeeze = 1 - Math.abs(t - 0.5) * 0.85;
      var d = 'M 0 ' + base.toFixed(1);
      for (var x = 0; x <= w; x += 24) {
        var u = x / w;
        var y = base
          + Math.sin(u * 3.1 + phs[0] + t * 2.4) * amps[0] * squeeze
          + Math.sin(u * 7.7 + phs[1] - t * 1.7) * amps[1] * 0.34 * squeeze
          + Math.sin(u * 13.3 + phs[2] + t * 3.1) * amps[2] * 0.15 * squeeze;
        d += ' L ' + x + ' ' + y.toFixed(1);
      }
      svg += '<path d="' + d + '" stroke-width="' + (i % 3 === 0 ? 1.1 : 0.7) + '" opacity="' + (0.45 + 0.55 * squeeze).toFixed(2) + '"/>';
    }
    el.innerHTML = svg + '</svg>';
  }
  document.querySelectorAll('[data-topo]').forEach(topo);

  /* ================================================================== */
  /* 02 — REVEAL OBSERVER                                               */
  /* Adds .is-in once, then stops observing. Staggers via --d.           */
  /* ================================================================== */
  var revealTargets = document.querySelectorAll('.rise, .mask, [data-reveal]');

  if (reduced || !('IntersectionObserver' in window)) {
    revealTargets.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    revealTargets.forEach(function (el, i) {
      // Stagger siblings that share a parent, capped so nothing feels slow.
      if (!el.style.getPropertyValue('--d')) {
        var idx = +(el.dataset.stagger || 0);
        if (idx) el.style.setProperty('--d', Math.min(idx * 0.09, 0.55) + 's');
      }
      io.observe(el);
    });
  }

  /* ================================================================== */
  /* 03 — SVG DRAW LENGTHS                                              */
  /* Measures each path so the dash animation is exact, not guessed.     */
  /* ================================================================== */
  document.querySelectorAll('.draw, .proc__path path').forEach(function (p) {
    try {
      var len = Math.ceil(p.getTotalLength());
      p.style.setProperty('--len', len);
      p.style.strokeDasharray = len;
      if (!reduced) p.style.strokeDashoffset = len;
    } catch (err) { /* path not renderable yet — harmless */ }
  });

  /* ================================================================== */
  /* 04 — NAVIGATION                                                    */
  /* ================================================================== */
  (function nav() {
    var bar = document.querySelector('.rk-nav');
    if (!bar) return;

    var burger = document.getElementById('navBurger');
    var panel = document.getElementById('navPanel');
    var label = burger && burger.querySelector('[data-burger-label]');
    var open = false;
    var lastFocus = null;

    /* ---- Header theme ------------------------------------------------ */
    /* A page declares its dark opening with [data-nav-anchor]; the header
       goes solid once that element has passed under the bar. Pages with no
       dark opening ship `is-locked` in the markup and are left alone, so a
       light page is never briefly light-on-light before this runs.

       A page that instead declares [data-tone] zones is handled by §13,
       which reads the tone of whatever is actually under the bar — the
       homepage now changes register several times and inside sections, and
       "past the first section" stopped describing it. The two must not both
       write is-solid. */
    if (!bar.classList.contains('is-locked') && !document.querySelector('[data-tone]')) {
      var anchor = document.querySelector('[data-nav-anchor]');
      onFrame(function () {
        var trigger = anchor ? anchor.offsetHeight - 90 : 80;
        bar.classList.toggle('is-solid', window.scrollY > trigger);
      });
    }

    if (!burger || !panel) return;

    var items = panel.querySelectorAll('.rk-menu__item');

    function setOpen(next) {
      open = next;
      bar.classList.toggle('is-open', open);

      if (open) {
        lastFocus = document.activeElement;
        panel.hidden = false;
        // Force a frame so the clip-path transition actually runs.
        void panel.offsetWidth;
        panel.dataset.open = 'true';
        document.body.style.overflow = 'hidden';
        items.forEach(function (li, i) {
          li.style.transitionDelay = reduced ? '0s' : (0.09 + i * 0.055) + 's';
        });
        var first = panel.querySelector('a, button');
        if (first) first.focus();
      } else {
        panel.dataset.open = 'false';
        document.body.style.overflow = '';
        items.forEach(function (li) { li.style.transitionDelay = '0s'; });
        window.setTimeout(function () {
          if (!open) panel.hidden = true;
        }, reduced ? 0 : 820);
        if (lastFocus) lastFocus.focus();
      }

      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (label) label.textContent = open ? 'Bezár' : 'Menü';
    }

    burger.addEventListener('click', function () { setOpen(!open); });

    panel.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', function (e) {
      if (!open) return;
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key !== 'Tab') return;

      // Focus trap
      var f = panel.querySelectorAll('a[href], button:not([disabled])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
  })();

  /* ================================================================== */
  /* 05/06 — RETIRED IN PHASE 2                                          */
  /* ------------------------------------------------------------------ */
  /* The hero parallax composition and the pinned LAND -> WATER -> LIFE  */
  /* sequence both lived here. The Living Ground (rk-ground.js) now owns */
  /* that ground: one canvas, one scene, one scroll timeline. Leaving    */
  /* two dead controllers in place that silently no-op on every page     */
  /* only invites someone to "fix" them back into life later.            */
  /* ================================================================== */

  /* ================================================================== */
  /* 07 — SERVICES CURSOR PREVIEW                                       */
  /* Desktop pointer only; never shown on touch (CSS also enforces it).  */
  /* ================================================================== */
  (function servicePeek() {
    var list = document.querySelector('[data-svc]');
    var peek = document.getElementById('svcPeek');
    if (!list || !peek || !fine || reduced) return;

    var figs = peek.querySelectorAll('figure');
    var x = 0, y = 0, cx = 0, cy = 0, raf = null;

    function loop() {
      cx += (x - cx) * 0.14;
      cy += (y - cy) * 0.14;
      peek.style.transform = 'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0) translate(-50%,-50%)' +
        (peek.classList.contains('is-on') ? ' scale(1)' : ' scale(.92)');
      raf = requestAnimationFrame(loop);
    }

    list.addEventListener('pointermove', function (e) {
      x = e.clientX; y = e.clientY;
      if (!raf) { cx = x; cy = y; raf = requestAnimationFrame(loop); }
    });

    list.querySelectorAll('[data-peek]').forEach(function (row) {
      row.addEventListener('pointerenter', function () {
        var id = row.dataset.peek;
        figs.forEach(function (f) { f.classList.toggle('is-live', f.dataset.peekId === id); });
        peek.classList.add('is-on');
      });
    });

    list.addEventListener('pointerleave', function () {
      peek.classList.remove('is-on');
    });
  })();

  /* ================================================================== */
  /* 08 — MAGNETIC CTA                                                  */
  /* A single, restrained pull on primary conversion buttons.           */
  /* ================================================================== */
  if (fine && !reduced) {
    document.querySelectorAll('[data-magnetic]').forEach(function (el) {
      var mx = 0, my = 0, cx2 = 0, cy2 = 0, r2 = null;

      function tick() {
        cx2 += (mx - cx2) * 0.18;
        cy2 += (my - cy2) * 0.18;
        el.style.transform = 'translate(' + cx2.toFixed(2) + 'px,' + cy2.toFixed(2) + 'px)';
        if (Math.abs(mx - cx2) > 0.08 || Math.abs(my - cy2) > 0.08) {
          r2 = requestAnimationFrame(tick);
        } else { r2 = null; el.style.transform = mx === 0 && my === 0 ? '' : el.style.transform; }
      }
      el.addEventListener('pointermove', function (e) {
        var b = el.getBoundingClientRect();
        mx = (e.clientX - (b.left + b.width / 2)) * 0.22;
        my = (e.clientY - (b.top + b.height / 2)) * 0.32;
        if (!r2) r2 = requestAnimationFrame(tick);
      });
      el.addEventListener('pointerleave', function () {
        mx = 0; my = 0;
        if (!r2) r2 = requestAnimationFrame(tick);
      });
    });
  }

  /* ================================================================== */
  /* 09 — REFERENCES ARCHIVE: POINTER LABEL + LIGHTBOX                   */
  /* ------------------------------------------------------------------ */
  /* Progressive enhancement throughout: without JS every plate is still */
  /* a real image with a real caption, and the button simply does        */
  /* nothing rather than promising a view that cannot open.              */
  /* ================================================================== */
  (function archive() {
    // The References page splits its index either side of the landscape
    // intermission, so there is more than one archive container. Collect
    // every plate in document order — that order IS the lightbox order.
    var archs = document.querySelectorAll('[data-arch]');
    if (!archs.length) return;

    var plates = Array.prototype.slice.call(document.querySelectorAll('[data-arch] [data-lb]'));
    if (!plates.length) return;

    /* ---- Pointer label ("NÉZET") ------------------------------------ */
    var cursor = document.getElementById('archCursor');
    if (cursor && fine && !reduced) {
      var x = 0, y = 0, cx = 0, cy = 0, raf = null;

      function follow() {
        cx += (x - cx) * 0.16;
        cy += (y - cy) * 0.16;
        cursor.style.transform =
          'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0)' +
          ' translate(-50%,-50%)' +
          (cursor.classList.contains('is-on') ? ' scale(1)' : ' scale(.7)');
        raf = requestAnimationFrame(follow);
      }

      archs.forEach(function (arch) {
        arch.addEventListener('pointermove', function (e) {
          x = e.clientX; y = e.clientY;
          if (!raf) { cx = x; cy = y; raf = requestAnimationFrame(follow); }
        });
        arch.addEventListener('pointerleave', function () { cursor.classList.remove('is-on'); });
      });
      plates.forEach(function (b) {
        b.addEventListener('pointerenter', function () { cursor.classList.add('is-on'); });
        b.addEventListener('pointerleave', function () { cursor.classList.remove('is-on'); });
      });
    }

    /* ---- Lightbox --------------------------------------------------- */
    var lb = document.getElementById('lb');
    if (!lb) return;

    var lbImg = document.getElementById('lbImg');
    var lbNo = document.getElementById('lbNo');
    var lbTtl = document.getElementById('lbTtl');
    var lbTag = document.getElementById('lbTag');
    var lbDesc = document.getElementById('lbDesc');
    var lbX = document.getElementById('lbX');
    var lbP = document.getElementById('lbP');
    var lbN = document.getElementById('lbN');

    var i = 0, lastFocus = null, closing = null;

    /* Read the slide data straight off the markup, so the archive stays a
       single source of truth: adding a plate to the HTML adds it here. */
    var slides = plates.map(function (b) {
      var fig = b.closest('.arch__it');
      var img = b.querySelector('img');
      // The caption's descriptive line is the plain <span> — not the number
      // <b>, not .arch__tag and not .arch__desc.
      var title = fig && fig.querySelector('.arch__cap > span:not(.arch__tag):not(.arch__desc)');
      return {
        btn: b,
        full: b.dataset.full,
        alt: img ? img.getAttribute('alt') : '',
        title: title ? title.textContent.trim() : '',
        tag: fig ? ((fig.querySelector('.arch__tag') || {}).textContent || '').trim() : '',
        desc: fig ? ((fig.querySelector('.arch__desc') || {}).textContent || '').trim() : ''
      };
    });

    function render() {
      if (i < 0) i = slides.length - 1;
      if (i >= slides.length) i = 0;
      var s = slides[i];
      lbImg.src = s.full;
      lbImg.alt = s.alt;
      lbNo.textContent = (i + 1) + ' / ' + slides.length;
      lbTtl.textContent = s.title;
      lbTag.textContent = s.tag;
      lbDesc.textContent = s.desc;
    }

    function openAt(n) {
      // Remember the plate itself, not document.activeElement: a pointer
      // click does not necessarily focus the button, and focus must return
      // to the plate the visitor opened when the dialog closes.
      lastFocus = plates[n];
      i = n;
      if (closing) { window.clearTimeout(closing); closing = null; }
      lb.hidden = false;
      render();
      void lb.offsetWidth;               // force a frame so the fade runs
      lb.classList.add('is-on');
      document.body.style.overflow = 'hidden';
      lbX.focus();
    }

    function close() {
      lb.classList.remove('is-on');
      document.body.style.overflow = '';
      closing = window.setTimeout(function () {
        lb.hidden = true;
        // removeAttribute, not src='': an empty src is a spec edge case and
        // leaves a permanently "broken" image in the DOM.
        lbImg.removeAttribute('src');    // release the decoded full-size frame
        closing = null;
      }, reduced ? 0 : 360);
      if (lastFocus) lastFocus.focus();
    }

    plates.forEach(function (b, n) {
      b.addEventListener('click', function () { openAt(n); });
    });

    lbX.addEventListener('click', close);
    lbP.addEventListener('click', function () { i--; render(); });
    lbN.addEventListener('click', function () { i++; render(); });
    lb.addEventListener('click', function (e) {
      // Backdrop click closes; clicks on the image or the controls do not.
      if (e.target === lb || e.target.classList.contains('lb__stage')) close();
    });

    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowLeft') { i--; render(); return; }
      if (e.key === 'ArrowRight') { i++; render(); return; }
      if (e.key !== 'Tab') return;

      // Focus trap across the four controls.
      var f = lb.querySelectorAll('button:not([disabled])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    // Horizontal swipe on touch. Vertical drags are left to the browser.
    var sx = 0, sy = 0;
    lb.addEventListener('touchstart', function (e) {
      sx = e.changedTouches[0].clientX; sy = e.changedTouches[0].clientY;
    }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - sx;
      var dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        i += dx < 0 ? 1 : -1;
        render();
      }
    }, { passive: true });
  })();

  /* ================================================================== */
  /* 10 — QUOTE FORM  (Web3Forms)                                       */
  /* ------------------------------------------------------------------ */
  /* The submission call is carried over from the legacy script.js       */
  /* unchanged — same endpoint, same FormData, same access key. Only the */
  /* validation and the feedback around it are new.                      */
  /* ================================================================== */
  (function quoteForm() {
    var form = document.getElementById('quoteForm');
    if (!form) return;

    var status = document.getElementById('formStatus');
    var submit = document.getElementById('formSubmit');
    var submitText = submit ? submit.textContent : '';

    function say(kind, msg) {
      if (!status) return;
      status.className = 'frm__status is-on' + (kind === 'err' ? ' is-bad' : '');
      status.textContent = msg;
    }

    function fieldOf(el) { return el.closest('.frm__f'); }

    function validate(el) {
      var wrap = fieldOf(el);
      if (!wrap) return true;
      var ok = el.checkValidity();
      wrap.classList.toggle('is-bad', !ok);
      el.setAttribute('aria-invalid', ok ? 'false' : 'true');
      return ok;
    }

    // Validate on blur, then live once a field has already been flagged —
    // never while the visitor is still typing their first attempt.
    form.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (el.type === 'hidden' || el.name === 'botcheck') return;
      el.addEventListener('blur', function () { validate(el); });
      el.addEventListener('input', function () {
        var wrap = fieldOf(el);
        if (wrap && wrap.classList.contains('is-bad')) validate(el);
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      // Honeypot: if it is checked, a bot filled it — drop it silently.
      var hp = form.querySelector('input[name="botcheck"]');
      if (hp && hp.checked) return;

      var bad = null;
      form.querySelectorAll('input, select, textarea').forEach(function (el) {
        if (el.type === 'hidden' || el.name === 'botcheck') return;
        if (!validate(el) && !bad) bad = el;
      });
      if (bad) {
        // Worded without a colour reference on purpose: the invalid state is
        // marked with a rule and a written message, not with red alone.
        say('err', 'Néhány mező hiányzik vagy hibás. Kérjük, nézd át a megjelölt sorokat.');
        bad.focus();
        return;
      }

      if (submit) { submit.disabled = true; submit.textContent = 'Küldés folyamatban…'; }

      fetch('https://api.web3forms.com/submit', { method: 'POST', body: new FormData(form) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.success) {
            say('ok', 'Köszönjük! Megkaptuk az ajánlatkérésed – 1 munkanapon belül keresünk telefonon.');
            form.reset();
            form.querySelectorAll('.frm__f.is-bad').forEach(function (w) { w.classList.remove('is-bad'); });
          } else {
            say('err', 'Sajnos nem sikerült elküldeni. Kérjük, hívj minket: +36 30 726 0024');
          }
        })
        .catch(function () {
          say('err', 'Hálózati hiba. Kérjük, hívj minket: +36 30 726 0024');
        })
        .finally(function () {
          if (submit) { submit.disabled = false; submit.textContent = submitText; }
        });
    });
  })();

  /* ================================================================== */
  /* 14 — THE SECTION WORLD                                 [PHASE 2.3]  */
  /* ------------------------------------------------------------------ */
  /* ONE PIECE OF LAND, THREE SECTIONS OF THE PAGE.                      */
  /*                                                                     */
  /* Phase 2.2 gave SERVICES, PROCESS and PROOF three unrelated          */
  /* drawings: a contour set, an assembly diagram and a rule. They were  */
  /* in the same graphic language and they were not the same OBJECT, so  */
  /* the second half of the page read as a well-dressed website after a  */
  /* film. This module is the object.                                    */
  /*                                                                     */
  /* One geometry, defined once, in world units — a twelve-metre garden  */
  /* cross-section with grade at y = 0 and depth positive downward. Three*/
  /* instances of it, one per section, each driven by its own scroll     */
  /* progress through its own CAMERA and its own LAYER SCHEDULE. The     */
  /* sections do not share an element (they cannot — each is pinned in   */
  /* its own sticky stage), they share a DEFINITION, and each one's      */
  /* closing camera and layer state is the next one's opening camera and */
  /* layer state. That is what makes the boundary invisible.             */
  /*                                                                     */
  /* WHY SVG AND NOT A SECOND WebGL SCENE                                */
  /*   Everything asked of this world is section drawing: exact          */
  /*   geometry, hairlines that stay one pixel at any magnification,     */
  /*   strata that read as a technical cut. That is SVG's own subject.   */
  /*   A canvas would need a permanent render loop, a second renderer    */
  /*   lifecycle and its own resize path, and would give back softer     */
  /*   lines. The Living Ground stays the page's only WebGL.             */
  /*                                                                     */
  /* WHAT COSTS WHAT, PER FRAME                                          */
  /*   the camera        one viewBox attribute write                     */
  /*   the layers        one opacity write per layer that changed        */
  /*   the geometry      NOTHING, unless --relief or --depth changed by  */
  /*                     more than a hundredth, which happens only       */
  /*                     during the beat where the line becomes terrain  */
  /*                                                                     */
  /* THE ONE IDEA THIS IS BUILT AROUND                                   */
  /*   At relief 0 and depth 0 every path in the world collapses onto    */
  /*   y = 0 — a single straight horizontal line. That line is the one   */
  /*   the last project plate was crushed into. Raising relief and depth */
  /*   does not ADD terrain to a drawing: it is the drawing BECOMING     */
  /*   terrain, which is the whole argument of the services section.     */
  /* ================================================================== */
  var RK_WORLD = (function () {

    /* ---- THE LAND, in world units -------------------------------------
       x runs the length of the section; y is depth below grade. The
       excavated span is inset from the world's edges so the cut has ends
       to draw, and the world is much wider than the cut so the camera can
       pull back without running out of ground. */
    var X0 = -700, X1 = 1900;          // the world
    var CUT0 = 40, CUT1 = 1160;        // the excavated span
    var FLOOR = 900;                   // fill bodies run to here, off view

    /* Depth of the top of each stratum, below grade. */
    var STRATA = [
      { k: 'top', d: 0,   c: 'wrl__st--top' },   // termőtalaj
      { k: 'sub', d: 46,  c: 'wrl__st--sub' },   // altalaj
      { k: 'str', d: 104, c: 'wrl__st--str' },   // teherhordó / ágyazat
      { k: 'drn', d: 152, c: 'wrl__st--drn' }    // szűrő / drén
    ];
    var Y_MAIN = 38;                   // the irrigation main
    var Y_DRIP = 62;                   // the subsurface dripline (SDI)
    var Y_ROOT = 98;                   // how far the root zone reaches
    var LATS = [200, 440, 680, 920, 1120];   // laterals / emitters
    var SLABS = [[470, 84], [566, 84]];      // paving, x and width

    /* ---- THE PROFILE --------------------------------------------------
       Deterministic, like §01's contour generator and for the same
       reason: the composition must be identical on every load. Three
       sines, total amplitude about 17 units on a 210-unit build-up —
       a real garden's fall, not a mountain. */
    function P(x) {
      return 9 * Math.sin(x / 300 + 0.6)
           + 5 * Math.sin(x / 127 - 1.1)
           + 3 * Math.sin(x / 61 + 2.2);
    }

    /* EACH STRATUM HAS ITS OWN SURFACE.
       Offsetting one profile four times gives four parallel bands, and
       four parallel bands is a diagram of soil rather than soil: real
       strata flatten with depth, because the surface relief is recent
       and what is underneath it is not, and they do not agree with each
       other. ATT is how much of the surface's fall each layer still
       carries; the second term is that layer's own long undulation.
       Every amplitude here is far smaller than the 46-unit gap between
       strata, so the layers can never cross and invert the drawing. */
    var ATT   = [1, 0.86, 0.64, 0.46];
    var SWELL = [0, 4.5, 7, 9];
    var SW_F  = [0, 1 / 210, 1 / 173, 1 / 246];
    var SW_P  = [0, 1.9, 3.4, 5.1];
    function Pk(x, k) {
      return P(x) * ATT[k] + SWELL[k] * Math.sin(x * SW_F[k] + SW_P[k]);
    }

    /* Catmull-Rom through the samples, emitted as cubics. A polyline at
       this sample density is visibly faceted once the camera is inside
       the root zone, and the whole point of that state is that the
       visitor is looking at ground rather than at a chart. */
    function profileD(relief, closed, k, drop) {
      var n = 26, d = '', pts = [];
      for (var i = 0; i <= n; i++) {
        var x = X0 + (X1 - X0) * i / n;
        pts.push([x, Pk(x, k || 0) * relief + (drop || 0)]);
      }
      d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(2);
      for (var j = 0; j < pts.length - 1; j++) {
        var p0 = pts[j > 0 ? j - 1 : 0], p1 = pts[j], p2 = pts[j + 1];
        var p3 = pts[j + 2 < pts.length ? j + 2 : pts.length - 1];
        var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
        var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += 'C' + c1x.toFixed(1) + ' ' + c1y.toFixed(2) + ' ' +
                   c2x.toFixed(1) + ' ' + c2y.toFixed(2) + ' ' +
                   p2[0].toFixed(1) + ' ' + p2[1].toFixed(2);
      }
      if (closed) d += 'L' + X1 + ' ' + FLOOR + 'L' + X0 + ' ' + FLOOR + 'Z';
      return d;
    }

    var NS = 'http://www.w3.org/2000/svg';
    function el(name, attrs) {
      var e = document.createElementNS(NS, name);
      for (var k in attrs) if (attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
      return e;
    }
    function grp(cls, layer) {
      var g = el('g', { 'class': 'wrl__l ' + cls });
      g.dataset.l = layer;
      return g;
    }

    /* ---- THE MARKUP ---------------------------------------------------
       Built here rather than written into index.html three times. The
       three sections have to be the SAME object, and three hand-copied
       blocks of two hundred lines of SVG are three objects that merely
       resemble each other until someone edits one of them. Nothing here
       is content: it is aria-hidden throughout and every word the page
       actually says stays in the markup. */
    /* Every instance gets its own ids. Three copies of the world sharing
       one #wrlFill would all resolve to the first copy's path, so the
       services section's ground would silently drive the process
       section's — and the symptom would be a terrain that forms in the
       wrong section rather than an error. */
    var UID = 0;

    function build(host) {
      var uid = 'w' + (++UID);
      var ID_L = uid + 'l', ID_H = uid + 'h', ID_C = uid + 'c';
      var svg = el('svg', {
        'class': 'wrl__svg', xmlns: NS,
        preserveAspectRatio: 'xMidYMid meet',
        'aria-hidden': 'true', focusable: 'false',
        viewBox: '0 -300 1200 600'
      });

      var defs = el('defs');
      /* The technical register's fill. A section drawing's hatch, at the
         world's own scale, so it does not swim when the camera moves. */
      var pat = el('pattern', {
        id: ID_H, width: 14, height: 14,
        patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'
      });
      pat.appendChild(el('line', { x1: 0, y1: 0, x2: 0, y2: 14, 'class': 'wrl__hatch' }));
      defs.appendChild(pat);

      /* The right-hand half of the 70% comparison. The system belongs to
         ONE of the two sections; the main and the dripline are single
         paths that run the whole length of the world, so they are clipped
         rather than hidden — a dripline crossing the half of the drawing
         that is meant to show what happens without one is the comparison
         arguing against itself. */
      var clip = el('clipPath', { id: ID_C, clipPathUnits: 'userSpaceOnUse' });
      clip.appendChild(el('rect', { x: 618, y: -400, width: 384, height: 900 }));
      defs.appendChild(clip);

      /* The two shapes every layer is a copy of. Rebuilding these two is
         the entire cost of changing the terrain's relief. */
      /* Only ONE shared shape is left: the surface line. The strata each
         carry their own curve (see Pk), so they are real paths rather
         than four copies of one. */
      var pLine = el('path', { id: ID_L, d: profileD(0, false) });
      defs.appendChild(pLine);
      svg.appendChild(defs);

      /* SURVEY — contour information above grade, before the ground has
         any thickness. The first thing that happens to the inherited
         line is that it acquires terrain information. */
      var gc = grp('wrl__contour', 'contour');
      [-88, -62, -36, 26, 52].forEach(function (o) {
        gc.appendChild(el('use', { href: '#' + ID_L, y: o, 'class': 'wrl__cl' }));
      });
      svg.appendChild(gc);

      /* CUT AND FILL — where material is taken away and where it is
         brought in. Construction notation, not decoration. */
      var gf = grp('wrl__fill-marks', 'cutfill');
      [140, 300, 520, 760, 980].forEach(function (x, i) {
        var y = P(x);
        var up = i % 2 === 0;
        gf.appendChild(el('path', {
          'class': 'wrl__cf',
          d: 'M' + x + ' ' + (y + (up ? -34 : 34)).toFixed(1) + 'V' + y.toFixed(1) +
             'M' + (x - 7) + ' ' + (y + (up ? -12 : 12)).toFixed(1) +
             'L' + x + ' ' + y.toFixed(1) +
             'L' + (x + 7) + ' ' + (y + (up ? -12 : 12)).toFixed(1)
        }));
      });
      svg.appendChild(gf);

      /* THE GROUND. Painter's order, shallowest first: each stratum is
         the profile offset to its own depth with a body running off the
         bottom of the world, and the next one down covers everything
         below its own top edge. One <use> per stratum, and its y
         attribute is the only thing that changes when the ground gains
         or loses depth. */
      var gs = grp('wrl__strata', 'strata');
      var gh = grp('wrl__hatched', 'hatch');
      var gb = grp('wrl__bounds', 'bounds');
      STRATA.forEach(function (s, k) {
        gs.appendChild(el('path', { 'class': 'wrl__st ' + s.c, 'data-d': s.d, 'data-k': k, d: '' }));
        var hu = el('path', { 'class': 'wrl__hf', 'data-d': s.d, 'data-k': k, d: '' });
        hu.style.fill = 'url(#' + ID_H + ')';
        gh.appendChild(hu);
        gb.appendChild(el('path', { 'class': 'wrl__bd', 'data-d': s.d, 'data-k': k, d: '' }));
      });
      svg.appendChild(gs);
      svg.appendChild(gh);
      svg.appendChild(gb);

      /* THE ENDS OF THE CUT. What makes it a section and not a stack of
         bands: the excavation has two vertical faces. */
      var ge = grp('wrl__ends', 'ends');
      ge.appendChild(el('path', { 'class': 'wrl__ed', d: '' }));
      ge.appendChild(el('path', { 'class': 'wrl__ed', d: '' }));
      svg.appendChild(ge);

      /* GRIT in the structural layer — the aggregate the copy names. */
      var gg = grp('wrl__grit', 'grit');
      for (var i = 0; i < 22; i++) {
        var gx = CUT0 + 40 + i * ((CUT1 - CUT0 - 80) / 21);
        gg.appendChild(el('path', {
          'class': 'wrl__gt', 'data-x': gx.toFixed(1),
          'data-d': (116 + (i % 3) * 11).toFixed(1),
          d: 'M-7 0h14'
        }));
      }
      svg.appendChild(gg);

      /* THE NETWORK. Main, laterals dropping off it, emitters. */
      var gm = grp('wrl__main', 'main');
      gm.appendChild(el('path', { 'class': 'wrl__mn', d: '' }));
      svg.appendChild(gm);

      var gl = grp('wrl__lats', 'lat');
      LATS.forEach(function (x) {
        gl.appendChild(el('path', { 'class': 'wrl__lt', 'data-x': x, d: '' }));
      });
      svg.appendChild(gl);

      /* THE SUBSURFACE LINE and its emitters — the third service. */
      var gd = grp('wrl__drip', 'drip');
      gd.appendChild(el('path', { 'class': 'wrl__dp', d: '' }));
      LATS.forEach(function (x) {
        gd.appendChild(el('circle', { 'class': 'wrl__em', 'data-x': x, r: 4, cx: 0, cy: 0 }));
      });
      svg.appendChild(gd);

      /* THE WETTING LENS. Water is a CONSEQUENCE in the soil, not a blue
         pipe: an ellipse of damp earth around each emitter, and it only
         exists where there is dry earth on the other side of it. */
      /* TWO ELLIPSES PER EMITTER, not one. A single hard-edged shape is
         a shadow; the outer, fainter one is the front the moisture has
         reached and the inner one is where the soil is actually wet, and
         between them the ground reads as GRADED rather than switched. */
      var gw = grp('wrl__wet', 'wet');
      LATS.forEach(function (x, i) {
        gw.appendChild(el('ellipse', {
          /* 108, not 128. At 128 the fronts of adjacent emitters MEET on
             240-unit spacing and the whole stratum goes dark to its own
             edges — which reads as "this is a different soil", not as
             "water is spreading". 24 units of dry earth is the minimum
             that keeps the shape a shape. */
          'class': 'wrl__wt wrl__wt--front', 'data-x': x, 'data-i': i,
          rx: 108, ry: 42, cx: 0, cy: 0
        }));
        gw.appendChild(el('ellipse', {
          /* 88 x 34 around a dripline, on 240-unit spacing in a 98-unit
             root zone. The numbers are the same lesson the Living Ground's
             water shader had to learn: at a wider reach adjacent lenses
             MEET each other sideways and overrun the root zone vertically,
             the whole layer goes dark to its own edges, and the eye reads
             "this is a different soil" instead of "water is spreading".
             The shape only exists because there is dry earth around it. */
          'class': 'wrl__wt', 'data-x': x, 'data-i': i,
          rx: 88, ry: 34, cx: 0, cy: 0
        }));
      });
      svg.appendChild(gw);

      /* ROOTS occupying the same soil the water is in. */
      var gr = grp('wrl__roots', 'root');
      LATS.forEach(function (x) {
        gr.appendChild(el('path', { 'class': 'wrl__rt', 'data-x': x, d: '' }));
      });
      svg.appendChild(gr);

      /* THE FINISHED SURFACE. Turf on the profile, and two slabs sitting
         on their own bedding — the constructed edge the copy promises. */
      /* ══ THE INSTRUMENT ═══════════════════════════════════════════════
         PROOF does not get a world of its own. It gets THIS one, used as
         a measuring instrument: the same ground, the same grade, the same
         system, read four different ways. Every one of the four states
         below is a way of MEASURING the section that has just been built,
         which is what stops the proof section from being four unrelated
         graphics beside four numbers.

         These groups cost the other two instances twenty-odd hidden
         elements and nothing per frame — a layer with no schedule is
         written to visibility:hidden on the first pass and never touched
         again. That is the price of them being the same object. */

      /* EGY CSAPAT — four trades, one datum.
         Four copies of the site line enter mis-registered, each at its
         own offset and its own angle, and RESOLVE onto their correct
         positions in the section. Coordination is not a graphic about
         people; it is four drawings agreeing. */
      var gcv = grp('wrl__conv', 'conv');
      [[-150, -74, -2.4], [190, 96, 3.1], [-90, 128, 1.7], [130, -108, -3.6]]
        .forEach(function (o, i) {
          var u = el('use', { href: '#' + ID_L, 'class': 'wrl__cv',
            'data-dx': o[0], 'data-dy': o[1], 'data-r': o[2], 'data-i': i });
          gcv.appendChild(u);
        });
      svg.appendChild(gcv);

      /* 40 KM — a measured service radius over the ground, not a map.
         Concentric arcs from one point on the section, at 5, 10, 20 and
         40 of the same unit. Nothing is claimed about any place: there is
         no coastline, no road and no name anywhere in it, because the
         source material supports a radius and does not support a map. */
      var grd = grp('wrl__radius', 'radius');
      grd.appendChild(el('circle', { 'class': 'wrl__rc0', cx: 600, cy: 0, r: 5 }));
      [0.125, 0.25, 0.5, 1].forEach(function (f, i) {
        grd.appendChild(el('path', { 'class': 'wrl__rr' + (i === 3 ? ' wrl__rr--out' : ''),
          'data-f': f, d: '' }));
      });
      svg.appendChild(grd);

      /* 70% — two sections of the same soil, side by side.
         LEFT: water applied to the surface. It wets the top of the
         profile, most of it leaves again (the risers above grade) and
         the root zone stays dry.
         RIGHT: the same soil with the line under it. The water is where
         the roots are and nothing rises off the surface.
         The mechanism, not the number. The number is in the copy. */
      var gcp = grp('wrl__compare', 'compare');
      gcp.appendChild(el('path', { 'class': 'wrl__cpdiv', d: '' }));
      gcp.appendChild(el('path', { 'class': 'wrl__cpwetA', d: '' }));   // shallow band
      gcp.appendChild(el('path', { 'class': 'wrl__cpevap', d: '' }));   // what leaves
      gcp.appendChild(el('path', { 'class': 'wrl__cpdryA', d: '' }));   // dry root zone
      [['Szórófejes locsolás', 400, -1], ['Felszín alatti öntözés', 800, 1]].forEach(function (n) {
        var g = el('g', { 'class': 'wrl__cplb', 'data-x': n[1], 'data-dir': n[2] });
        var t = el('text', { 'class': 'wrl__ntx' });
        t.textContent = n[0];
        g.appendChild(t);
        gcp.appendChild(g);
      });
      svg.appendChild(gcp);

      /* 1 MUNKANAP — one working day across the finished surface.
         A raked shadow travelling over the ground and a time datum above
         it. No sun, no sunrise, no colour temperature: a shadow moving
         from one side of a garden to the other IS a day, and it is the
         only way this site would ever say so. */
      /* FIVE POSITIONS, NOT ONE.
         A single shadow that happens to be short at the moment the
         visitor stops scrolling says nothing; five raked positions of the
         SAME shadow, with the current one solid and the others held as
         ghosts, say "one day" in a still frame — which is the test this
         section has to pass. The time datum above carries a tick for
         each of them, so the shadow's positions ARE the hours. */
      var gdy = grp('wrl__day', 'day');
      [-1, -0.5, 0, 0.5, 1].forEach(function (t) {
        gdy.appendChild(el('path', { 'class': 'wrl__shadow', 'data-t': t, d: '' }));
      });
      gdy.appendChild(el('path', { 'class': 'wrl__daybar', d: '' }));
      gdy.appendChild(el('path', { 'class': 'wrl__daytick', d: '' }));
      gdy.appendChild(el('circle', { 'class': 'wrl__daymk', r: 4, cx: 0, cy: -190 }));
      svg.appendChild(gdy);

      /* TWO LABELS, AND ONLY TWO.
         The underground state is an immersion, not a technical drawing,
         and the brief for it is explicit: the visual has to carry the
         section. These name the two things a visitor cannot deduce from
         looking — that the line IS the dripline and that the darker soil
         around it is the wetted zone — and nothing else is named. */
      var gn = grp('wrl__notes', 'notes');
      /* Placed in the clear third of the underground framing — the type
         column owns the left 45% of that camera and a label under a
         monumental service name is not a label. */
      [['Csepegtető vezeték', 520, Y_DRIP, -15, 1],
       ['Nedvesedési zóna', 606, Y_DRIP + 40, 15, -1]].forEach(function (n) {
        var g = el('g', { 'class': 'wrl__nt', 'data-x': n[1], 'data-y': n[2],
                          'data-o': n[3], 'data-dir': n[4] });
        g.appendChild(el('path', { 'class': 'wrl__nl', d: '' }));
        var t = el('text', { 'class': 'wrl__ntx', x: 0, y: 0 });
        t.textContent = n[0];
        g.appendChild(t);
        gn.appendChild(g);
      });
      svg.appendChild(gn);

      /* GRADE. The line the whole world is measured from, and the line
         the project field handed over. It is never hidden — and it is
         painted BEFORE the surface furniture, because a slab is laid ON
         the ground line and a grade line drawn across the top of a paver
         cuts it in half. */
      var gg2 = grp('wrl__grade', 'grade');
      gg2.appendChild(el('use', { href: '#' + ID_L, y: 0, 'class': 'wrl__gd' }));
      svg.appendChild(gg2);

      var gt = grp('wrl__turf', 'turf');
      gt.appendChild(el('path', { 'class': 'wrl__tf', d: '' }));
      svg.appendChild(gt);

      var gp = grp('wrl__pave', 'pave');
      SLABS.forEach(function (s) {
        gp.appendChild(el('path', { 'class': 'wrl__pv', 'data-x': s[0], 'data-w': s[1], d: '' }));
      });
      svg.appendChild(gp);

      /* MEASUREMENT. A level reference, survey stations on it and one
         overall run. Graphic measurement only — there is no dimension
         figure anywhere in this world, because no source material
         supports one and an invented millimetre is a lie in a drawing
         whose whole authority is that it is measured. */
      var gms = grp('wrl__measure', 'measure');
      gms.appendChild(el('path', { 'class': 'wrl__lv', d: '' }));
      gms.appendChild(el('path', { 'class': 'wrl__tk', d: '' }));
      gms.appendChild(el('path', { 'class': 'wrl__run', d: '' }));
      svg.appendChild(gms);

      host.appendChild(svg);

      return {
        svg: svg,
        line: pLine,
        clip: 'url(#' + ID_C + ')',
        L: {},                    // layer groups, filled below
        relief: -1, depth: -1
      };
    }

    /* ---- GEOMETRY THAT DEPENDS ON RELIEF AND DEPTH --------------------
       Everything that is not a copy of the profile has to be placed ON
       the profile, so it moves when the ground does. Recomputed only
       when one of the two actually changes. */
    function reshape(w, relief, depth) {
      var svg = w.svg;
      w.line.setAttribute('d', profileD(relief, false));

      function py(x) { return P(x) * relief; }

      /* Strata, hatch and boundaries. Four surfaces, each its own curve at
         its own depth — eight path strings, rebuilt only when the ground
         actually changes shape. */
      var fills = [], lines = [];
      for (var k = 0; k < STRATA.length; k++) {
        var drop = STRATA[k].d * depth;
        fills[k] = profileD(relief, true, k, drop);
        lines[k] = profileD(relief, false, k, drop);
      }
      svg.querySelectorAll('.wrl__st').forEach(function (u) { u.setAttribute('d', fills[+u.dataset.k]); });
      svg.querySelectorAll('.wrl__hf').forEach(function (u) { u.setAttribute('d', fills[+u.dataset.k]); });
      svg.querySelectorAll('.wrl__bd').forEach(function (u) { u.setAttribute('d', lines[+u.dataset.k]); });

      /* THE TWO FACES OF THE EXCAVATION.
         Each runs from its own point on the surface down to its own point
         on the deepest boundary — which is what makes the cut read as a
         hole in ground that is not level rather than a rectangle. */
      [CUT0, CUT1].forEach(function (x, i) {
        var top = py(x);
        var bot = Pk(x, 3) * relief + (STRATA[3].d + 58) * depth;
        svg.querySelectorAll('.wrl__ed')[i]
           .setAttribute('d', 'M' + x + ' ' + top.toFixed(1) + 'V' + bot.toFixed(1));
      });

      // grit
      svg.querySelectorAll('.wrl__gt').forEach(function (p) {
        var x = +p.dataset.x;
        p.setAttribute('transform',
          'translate(' + x + ',' + (py(x) + +p.dataset.d * depth).toFixed(1) + ')');
      });

      // the main, along the profile at its own depth
      svg.querySelector('.wrl__mn').setAttribute('d', runAlong(relief, Y_MAIN * depth));
      // the dripline
      svg.querySelector('.wrl__dp').setAttribute('d', runAlong(relief, Y_DRIP * depth));

      // laterals drop from the main to the dripline
      svg.querySelectorAll('.wrl__lt').forEach(function (p) {
        var x = +p.dataset.x, y = py(x);
        p.setAttribute('d', 'M' + x + ' ' + (y + Y_MAIN * depth).toFixed(1) +
                            'V' + (y + Y_DRIP * depth).toFixed(1));
      });
      svg.querySelectorAll('.wrl__em').forEach(function (c) {
        var x = +c.dataset.x;
        c.setAttribute('cx', x);
        c.setAttribute('cy', (py(x) + Y_DRIP * depth).toFixed(1));
      });
      svg.querySelectorAll('.wrl__wt').forEach(function (c) {
        var x = +c.dataset.x;
        c.setAttribute('cx', x);
        c.setAttribute('cy', (py(x) + Y_DRIP * depth).toFixed(1));
      });
      svg.querySelectorAll('.wrl__rt').forEach(function (p) {
        var x = +p.dataset.x, y = py(x), h = Y_ROOT * depth;
        p.setAttribute('d',
          'M' + x + ' ' + y.toFixed(1) +
          'c-5 ' + (h * .42).toFixed(1) + ' -17 ' + (h * .66).toFixed(1) + ' -30 ' + h.toFixed(1) +
          'M' + x + ' ' + y.toFixed(1) +
          'c7 ' + (h * .44).toFixed(1) + ' 21 ' + (h * .68).toFixed(1) + ' 34 ' + (h * .96).toFixed(1) +
          'M' + x + ' ' + y.toFixed(1) +
          'c1 ' + (h * .46).toFixed(1) + ' 2 ' + (h * .74).toFixed(1) + ' 3 ' + (h * 1.06).toFixed(1));
      });

      /* TURF, IN TUFTS.
         An even comb of blades along the whole run reads as a fence, not
         as grass — the eye counts the interval instead of seeing a
         surface. Three blades to a tuft, tufts a long way apart, and the
         gaps between them are what make it a lawn. */
      var tf = '';
      for (var t = 0; t < 22; t++) {
        var bx = CUT0 + 30 + t * ((CUT1 - CUT0 - 60) / 21);
        for (var b = -1; b <= 1; b++) {
          var x2 = bx + b * 7;
          var bh = 11 + Math.abs(b) * -3 + (t % 2) * 2;
          tf += 'M' + x2.toFixed(1) + ' ' + py(x2).toFixed(1) +
                'l' + (b * 2.5).toFixed(1) + ' ' + (-bh).toFixed(1);
        }
      }
      svg.querySelector('.wrl__tf').setAttribute('d', tf);

      /* Slabs BEDDED into the surface, not resting on it: the top of the
         slab is flush with grade and its body is in the ground, which is
         how a laid paver actually sits and is the difference between a
         section and a diagram of a section. */
      svg.querySelectorAll('.wrl__pv').forEach(function (p) {
        var x = +p.dataset.x, wd = +p.dataset.w, y = py(x + wd / 2);
        p.setAttribute('d', 'M' + x + ' ' + (y - 4).toFixed(1) + 'h' + wd +
                            'v14h' + (-wd) + 'Z');
      });

      /* The two notes, on the objects they name. The leader is drawn in
         world units so it points at the right place at any camera height;
         the label itself is set in device pixels by the stylesheet, so it
         does not grow to a headline when the camera is close. */
      svg.querySelectorAll('.wrl__nt').forEach(function (g) {
        var x = +g.dataset.x, yy = py(x) + (+g.dataset.y) * depth;
        var off = +g.dataset.o, dir = +g.dataset.dir;
        g.querySelector('.wrl__nl').setAttribute('d',
          'M' + x + ' ' + yy.toFixed(1) + 'v' + off + 'h' + (dir * 20));
        var t = g.querySelector('.wrl__ntx');
        t.setAttribute('x', (x + dir * 24).toFixed(1));
        t.setAttribute('y', (yy + off).toFixed(1));
        t.setAttribute('text-anchor', dir < 0 ? 'end' : 'start');
      });

      /* ---- THE INSTRUMENT'S GEOMETRY ---------------------------------- */

      /* 40 KM. Arcs on the ground plane, so they are flattened: the
         camera is looking ALONG the section, not down at a plan, and a
         circle on the ground seen from the side of it is an ellipse. */
      svg.querySelectorAll('.wrl__rr').forEach(function (p) {
        var f = +p.dataset.f, R = 620 * f, ry = R * 0.30, cy = P(600) * relief;
        p.setAttribute('d',
          'M' + (600 - R) + ' ' + cy.toFixed(1) +
          'a' + R + ' ' + ry.toFixed(1) + ' 0 1 0 ' + (2 * R) + ' 0' +
          'a' + R + ' ' + ry.toFixed(1) + ' 0 1 0 ' + (-2 * R) + ' 0');
      });
      var rc0 = svg.querySelector('.wrl__rc0');
      if (rc0) rc0.setAttribute('cy', (P(600) * relief).toFixed(1));

      /* 70%. Both halves are the SAME soil — the only difference between
         them is where the water is, which is the entire argument. */
      var mid = 600, cy0 = P(mid) * relief;
      svg.querySelector('.wrl__cpdiv').setAttribute('d',
        'M' + mid + ' ' + (cy0 - 150).toFixed(1) + 'V' + (cy0 + 210 * depth).toFixed(1));
      /* A: the wetted band hugs the surface across the left half. */
      /* 240-560 and 640-960: both halves have to be COMPLETE in one
         frame or the visitor is comparing a thing with a thing they
         cannot see. That is what sets the camera height for this state,
         not the other way round. */
      var wa = '';
      for (var ax = 250; ax <= 555; ax += 10) {
        var ay = P(ax) * relief;
        wa += (ax === 250 ? 'M' : 'L') + ax + ' ' + (ay + 4).toFixed(1);
      }
      for (var bx = 555; bx >= 250; bx -= 10) {
        var by = P(bx) * relief;
        wa += 'L' + bx + ' ' + (by + 26 * depth).toFixed(1);
      }
      svg.querySelector('.wrl__cpwetA').setAttribute('d', wa + 'Z');
      /* A: what leaves again. Short risers off the surface — not arrows,
         not droplets; the same tick the cut-and-fill notation uses. */
      var ev = '';
      [280, 340, 400, 460, 520].forEach(function (x) {
        var y = P(x) * relief;
        ev += 'M' + x + ' ' + (y - 6).toFixed(1) + 'v-40' +
              'M' + (x - 5) + ' ' + (y - 34).toFixed(1) + 'l5 -12l5 12';
      });
      svg.querySelector('.wrl__cpevap').setAttribute('d', ev);
      /* A: and the root zone under it, dry. */
      var dr = '';
      [300, 400, 500].forEach(function (x) {
        var y = P(x) * relief, h = Y_ROOT * depth;
        dr += 'M' + x + ' ' + (y + 26 * depth).toFixed(1) +
              'c-5 ' + (h * .32).toFixed(1) + ' -15 ' + (h * .5).toFixed(1) + ' -26 ' + (h * .72).toFixed(1) +
              'M' + x + ' ' + (y + 26 * depth).toFixed(1) +
              'c6 ' + (h * .34).toFixed(1) + ' 18 ' + (h * .52).toFixed(1) + ' 29 ' + (h * .70).toFixed(1);
      });
      svg.querySelector('.wrl__cpdryA').setAttribute('d', dr);
      svg.querySelectorAll('.wrl__cplb').forEach(function (g) {
        var x = +g.dataset.x;
        var t = g.querySelector('text');
        t.setAttribute('x', x);
        t.setAttribute('y', (P(x) * relief - 74).toFixed(1));
        t.setAttribute('text-anchor', 'middle');
      });

      /* 1 MUNKANAP. The shadow is cast by the paving's own edge, so it
         belongs to the garden rather than being a shape laid over it.
         --day drives its length and direction from rk.js. */
      /* A SHADOW ON A SECTION IS A BAND ON THE SURFACE, not a shape
         lying beside it. Seen edge-on, ground in shade is a stretch of
         the profile that is darker — so each shadow is the profile
         itself, from the paving's edge to where the light reaches,
         thickened into the top of the topsoil. */
      var dx0 = 650;
      svg.querySelectorAll('.wrl__shadow').forEach(function (p) {
        var t = +p.dataset.t, len = 330 * t;
        var a = Math.min(dx0, dx0 + len), b = Math.max(dx0, dx0 + len);
        if (b - a < 8) { p.setAttribute('d', ''); return; }
        var d = '', x;
        for (x = a; x <= b; x += 12) d += (d ? 'L' : 'M') + x.toFixed(1) + ' ' + (P(x) * relief).toFixed(1);
        d += 'L' + b.toFixed(1) + ' ' + (P(b) * relief).toFixed(1);
        for (x = b; x >= a; x -= 12) d += 'L' + x.toFixed(1) + ' ' + (P(x) * relief + 13).toFixed(1);
        p.setAttribute('d', d + 'Z');
      });
      svg.querySelector('.wrl__daybar').setAttribute('d', 'M180 -190H1020');
      var dt = '';
      [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
        dt += 'M' + (180 + 840 * f) + ' -190v9';
      });
      svg.querySelector('.wrl__daytick').setAttribute('d', dt);

      // measurement apparatus
      svg.querySelector('.wrl__lv').setAttribute('d', 'M' + X0 + ' -120H' + X1);
      var tk = '';
      [180, 460, 740, 1020].forEach(function (x) {
        tk += 'M' + x + ' ' + py(x).toFixed(1) + 'V-120M' + (x - 8) + ' -120h16';
      });
      svg.querySelector('.wrl__tk').setAttribute('d', tk);
      svg.querySelector('.wrl__run').setAttribute('d',
        'M' + CUT0 + ' ' + (py(CUT0) + 250 * depth + 30).toFixed(1) + 'v14' +
        'M' + CUT0 + ' ' + (py(CUT0) + 250 * depth + 37).toFixed(1) + 'H' + CUT1 +
        'M' + CUT1 + ' ' + (py(CUT1) + 250 * depth + 30).toFixed(1) + 'v14');

      w.relief = relief;
      w.depth = depth;
    }

    /* The main and the dripline follow the ground, so they are the
       profile again — one more copy rather than a straight pipe under a
       curved surface, which is the detail that makes a section drawing
       look drawn by someone who has dug one. */
    function runAlong(relief, off) {
      var d = '', n = 18;
      for (var i = 0; i <= n; i++) {
        var x = CUT0 + (CUT1 - CUT0) * i / n;
        var y = P(x) * relief + off;
        d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(2);
      }
      return d;
    }

    /* ---- THE CAMERA ---------------------------------------------------
       Four numbers: where along the section we are looking, how much of
       the world's HEIGHT is in frame, which world height is anchored,
       and where on the screen that anchor sits.

       The last two are what makes the boundaries work. The project field
       leaves a rule at 46% of the viewport; this world opens with grade
       anchored at 46% of the viewport. It is the same line because it is
       in the same place, at the same weight, in the same colour — not
       because two rules were cross-faded. */
    function camera(w, keys, q, stage) {
      var i = 0;
      while (i < keys.length - 2 && q > keys[i + 1][0]) i++;
      var a = keys[i], b = keys[i + 1];
      var t = b[0] === a[0] ? 0 : clamp((q - a[0]) / (b[0] - a[0]), 0, 1);
      t = t * t * (3 - 2 * t);
      var cx = a[1] + (b[1] - a[1]) * t;
      var H  = a[2] + (b[2] - a[2]) * t;
      var ay = a[3] + (b[3] - a[3]) * t;
      var af = a[4] + (b[4] - a[4]) * t;

      var r = stage.getBoundingClientRect();
      var vbW = H * (r.width / Math.max(r.height, 1));
      var vb = (cx - vbW / 2).toFixed(1) + ' ' + (ay - af * H).toFixed(1) + ' ' +
               vbW.toFixed(1) + ' ' + H.toFixed(1);
      if (w.__vb !== vb) {
        w.__vb = vb;
        w.svg.setAttribute('viewBox', vb);
        /* HOW MANY WORLD UNITS ONE DEVICE PIXEL IS, right now.
           Stroke widths hold themselves at one pixel through
           vector-effect, but SVG text has no equivalent — set in world
           units it would arrive as a headline the moment the camera got
           close. Anything that has to stay a fixed size on the SCREEN is
           expressed as a multiple of this. */
        w.svg.style.setProperty('--wu', (H / Math.max(r.height, 1)).toFixed(4));
      }
    }

    /* ---- THE SCHEDULE -------------------------------------------------
       A layer is quoted as [in-start, in-end] or as
       [in-start, in-end, out-start, out-end]. Two numbers means it
       arrives and STAYS, which is the default on purpose: this world is
       assembled, and a component that has been built does not un-build
       itself because the scroll moved on. */
    function ramp(q, a, b) { return b <= a ? (q >= a ? 1 : 0) : clamp((q - a) / (b - a), 0, 1); }
    function band(q, s) {
      /* ABSENT MEANS ABSENT. A missing schedule is a layer this section
         does not use, not a layer at full strength — the difference is
         the whole drawing, and getting it the wrong way round showed the
         technical hatch over the physical ground. */
      if (!s) return 0;
      /* A schedule may also be a FUNCTION of q. Two numbers say "arrives
         and stays" and four say "arrives, holds, leaves", which covers
         every layer — but not the process section's depth, which has to
         go 1 -> 0 -> 1: the ground arrives fully built from SERVICES, is
         stripped back to a survey line, and is then constructed again.
         Expressing that as a band would need a fifth and sixth number
         nobody could read. */
      if (typeof s === 'function') return clamp(s(q), 0, 1);
      var v = ramp(q, s[0], s[1]);
      if (s.length > 2) v *= 1 - ramp(q, s[2], s[3]);
      return v;
    }
    /* Quoted by any layer that is present for the whole of a section —
       grade, above all, which is the object the section inherited. */
    var ALWAYS = [-1, -1];

    /* ---- ONE INSTANCE -------------------------------------------------
       mount() gives a host element its own copy of the world and returns
       the one function that drives it. Everything a section has to
       decide is in the options: where the camera goes, how the ground
       forms, which register it is drawn in, and when each component
       arrives. */
    function mount(host, opt) {
      var w = build(host);
      var groups = {};
      host.querySelectorAll('[data-l]').forEach(function (g) { groups[g.dataset.l] = g; });
      var stage = host.closest('.lyr__stage,.asm__stage,.prf__stage') || host;

      /* Rounded to a hundredth before it is compared: the terrain's shape
         is rebuilt only when the shape actually changes, so for the great
         majority of the run — where the ground is simply THERE — this
         costs one comparison and nothing else. */
      /* PORTRAIT IS NOT LANDSCAPE CROPPED.
         The camera is quoted as a HEIGHT of world in frame, so on a phone
         the same numbers would show the same depth through a window less
         than half as wide — 270 world units of a 1120-unit cut, chosen by
         the aspect ratio rather than by anyone. A phone gets its own
         table: the same states, framed as a two-to-four-metre DETAIL of
         the same section, with each state's x chosen to hold the thing
         that state is about. Same world, same transformations, composed
         for the screen it is on. */
      function keys() {
        return (opt.camMob && stage.clientHeight > stage.clientWidth) ? opt.camMob : opt.cam;
      }

      function set(q) {
        camera(w, keys(), q, stage);

        var relief = Math.round(band(q, opt.relief) * 100) / 100;
        var depth  = Math.round(band(q, opt.depth) * 100) / 100;
        if (relief !== w.relief || depth !== w.depth) reshape(w, relief, depth);

        var tech = band(q, opt.tech);
        if (w.__tech !== tech) {
          w.__tech = tech;
          host.style.setProperty('--tech', tech.toFixed(3));
        }

        /* EVERY layer is written, not only the scheduled ones. A world
           instance that leaves an unlisted group alone leaves it at its
           default — which is fully visible — so the underground state's
           two annotations turned up in the middle of the process
           section's technical drawing, and the symptom looked like a
           labelling bug rather than a missing default. */
        for (var k in groups) {
          var g = groups[k];
          var o = band(q, opt.layers[k]);
          /* The hatch belongs to the TECHNICAL register and to its own
             schedule at the same time. Written as an inline opacity by
             this loop it silently outranked the stylesheet's
             opacity:var(--tech) — so the hatching stayed on the finished
             garden at the end of the process section, which is a
             construction drawing's hatching over a lawn. */
          if (k === 'hatch') o *= tech;
          if (g.__o === o) continue;
          g.__o = o;
          g.style.opacity = o.toFixed(3);
          /* Hidden, not merely transparent — a layer at opacity 0 is
             still composited, and this world has fourteen of them. */
          g.style.visibility = o > 0.004 ? 'visible' : 'hidden';
        }
        if (opt.after) opt.after(q, host, groups);
      }

      set(opt.at !== undefined ? opt.at : 0);
      return { set: set, svg: w.svg, groups: groups, clip: w.clip };
    }

    return {
      mount: mount,
      ALWAYS: ALWAYS,
      P: P,
      CUT0: CUT0, CUT1: CUT1,
      Y_DRIP: Y_DRIP
    };
  })();

  /* ================================================================== */
  /* 12 — THE CONTINUITY LAYER                              [PHASE 2.2]  */
  /* ------------------------------------------------------------------ */
  /* Everything below the Living Ground, choreographed.                  */
  /*                                                                     */
  /* ONE READER. Every stage here registers on the shared rAF loop at    */
  /* the top of this file — the same one the header uses. There is no    */
  /* second scroll listener, no rAF of its own, no animation library and */
  /* no continuous loop: when the visitor stops scrolling, this costs    */
  /* nothing. The WebGL loop has already been stopped by its own         */
  /* IntersectionObserver by the time any of this is on screen.          */
  /*                                                                     */
  /* NOTHING HERE IS A SCROLL-TRIGGERED REVEAL. Each stage publishes one */
  /* progress value and the composition is a function of it, so elements */
  /* arrive because the thing they belong to moved — not because an      */
  /* observer fired.                                                     */
  /* ================================================================== */
  (function continuity() {
    /* REDUCED MOTION IS STILLED, NOT ABSENT.                 [PHASE 2.3]

       §32.10 of rk.css collapses every stage to ordinary flow and
       resolves every state to its composed form, and the scroll readers
       do not register — writing inline transforms onto a page that is
       deliberately not moving would only fight the stylesheet.

       But the three sections below are now built around a DRAWING, and a
       drawing that is never constructed is not a stilled composition: it
       is a hole. So each world is still mounted, once, at an authored
       point of its own run — the frame that says the most about that
       section standing alone — and then left there. No reader, no rAF, no
       second state. The visitor gets three composed section drawings
       instead of three empty boxes.

       The header (§13) still runs — navigation is not motion. */
    var still = reduced;

    /* DETERMINISTIC STAGE STATES.
       The same idea as rk-ground.js's ?scene=, and for the same reason: a
       choreographed stage can only be judged at a KNOWN point in its run,
       and reproducing that point by scrolling is neither exact nor
       repeatable. With ?stage= in the URL every stage below can be frozen:

         ?stage=fld:.30            one stage, one point
         ?stage=lyr:.5,asm:.8      several at once
         window.RK_STAGE.set('prf', .62)   live, from the console
         window.RK_STAGE.free()            hand them all back to the scroll

       Dead code without the parameter — the map is empty and the lookup is
       one property read per stage per frame. */
    var forced = null;
    if (/(^|[?&])stage=/.test(location.search)) {
      forced = {};
      (new URLSearchParams(location.search).get('stage') || '').split(',').forEach(function (pair) {
        var kv = pair.split(':');
        if (kv.length === 2) forced[kv[0].trim()] = clamp(parseFloat(kv[1]), 0, 1);
      });
      window.RK_STAGE = {
        map: forced,
        set: function (k, v) { forced[k] = clamp(v, 0, 1); runReaders(); },
        free: function () { forced = null; runReaders(); }
      };
    }

    /* A stage's progress is its own sticky travel: how far its pinned
       frame has moved through the block that holds it. Identical to the
       Living Ground's readProgress(), deliberately — the page has one way
       of measuring this. */
    function travel(pin, stage, key) {
      if (forced && key && forced[key] !== undefined) return forced[key];
      var r = pin.getBoundingClientRect();
      var span = r.height - stage.offsetHeight;
      if (span <= 0) return r.top <= 0 ? 1 : 0;
      return clamp(-r.top / span, 0, 1);
    }
    function ease(t) { return t * t * (3 - 2 * t); }
    /* Presence of one slot in a sequence of n, given the run's progress.
       1 while the slot owns the screen, 0 well before and well after, with
       real emptiness in between — which is what stops five statements from
       reading as a table. */
    function presence(q, i, n, width) {
      var u = (q - (i + 0.5) / n) * n;
      return { u: u, o: clamp(1 - Math.abs(u) * (width || 1.9), 0, 1) };
    }
    /* A trapezoid: up over a-b, held b-c, down over c-d. Used wherever
       something has to be present FOR A WHILE rather than at an instant —
       the beats where a spatial event owns the screen and the typography
       steps back are all quoted this way. */
    function band3(q, a, b, c, d) {
      return clamp((q - a) / (b - a), 0, 1) * (1 - clamp((q - c) / (d - c), 0, 1));
    }
    function write(el, prop, v) {
      if (el.__w !== v) { el.__w = v; el.style.setProperty(prop, v); }
    }
    function toggle(el, cls, on) {
      if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
    }
    /* Off-screen stages must cost nothing per frame. */
    function idle(pin) {
      var r = pin.getBoundingClientRect();
      return r.bottom < -200 || r.top > window.innerHeight + 200;
    }

    /* ---------------------------------------------------------------- */
    /* 12.1 — THE BRIDGE                                                 */
    /* ---------------------------------------------------------------- */
    /* The photograph the Living Ground resolved into does not get        */
    /* replaced: its EDGES close and it becomes a field plate while the    */
    /* metadata writes itself into the space that opens. Everything is a   */
    /* function of --q in CSS; this only publishes the number.            */
    (function bridge() {
      var pin = document.querySelector('[data-brg]');
      if (!pin) return;
      var stage = pin.querySelector('.brg__stage');
      var plate = pin.querySelector('[data-brg-plate]');
      if (!stage) return;

      if (still) return;

      onFrame(function () {
        if (idle(pin) && !forced) return;

        /* THE CURTAIN HOLD.
           rk.css pulls this section up by one viewport so its first frame is
           pinned underneath the Living Ground's identical last frame. That
           overlap costs exactly one viewport of scroll, and during it the
           plate is not visible — it is behind the frame it is pretending to
           be. So the run does not start until the curtain has gone, or the
           whole contraction would happen where nobody can see it. */
        var q;
        if (forced && forced.brg !== undefined) {
          q = forced.brg;
        } else {
          var r = pin.getBoundingClientRect();
          var hold = stage.offsetHeight;
          var span = r.height - hold - hold;
          q = span > 0 ? clamp((-r.top - hold) / span, 0, 1) : (r.top <= -hold ? 1 : 0);
        }
        write(stage, '--q', ease(q).toFixed(4));
        /* The last beat lifts the finished sheet out of the frame, so the
           field behind it is REVEALED rather than faded up. */
        if (plate) {
          var lift = clamp((q - 0.86) / 0.14, 0, 1);
          plate.style.transform = lift > 0 ? 'translate3d(0,' + (-lift * 14).toFixed(2) + 'svh,0)' : '';
        }
      });
    })();

    /* ---------------------------------------------------------------- */
    /* 12.2 — THE FIELD                                                  */
    /* ---------------------------------------------------------------- */
    /* Seven sheets hung at authored positions on a receding diagonal.    */
    /*                                                                    */
    /* The whole composition moves with ONE transform on ONE element —    */
    /* the plates only carry their own depth — so travelling the entire   */
    /* field costs a single transform write per frame plus one opacity    */
    /* per plate. That is the reason this is DOM and not a second WebGL   */
    /* scene: at this fidelity a canvas would buy nothing and cost a      */
    /* permanent render loop.                                             */
    /*                                                                    */
    /*   A  lateral travel, vw        B  forward travel, px               */
    /*                                                                    */
    /* B is large on purpose. At a shallow forward travel the stations sit */
    /* only a few hundred pixels apart in depth, five plates are within a  */
    /* stop of each other's size, and the field reads as OVERLAP rather    */
    /* than as depth — which is the exact failure a masonry grid has.      */
    /*                                                                     */
    /* PHASE 2.3 — WHY THESE TWO NUMBERS MOVED.                            */
    /* The depth was mathematically right and perceptually wrong. With the */
    /* stage's 1500px perspective a plate's scale is P/(P-d), so the OLD   */
    /* release depth of 720 capped every plate in the section at 1.92x —   */
    /* and the largest plate on the page therefore never reached 60vw. The */
    /* field read as "photographs at several sizes", which is a gallery.   */
    /*                                                                     */
    /* The release is now authored PER PLATE (data-near / data-cull). The  */
    /* three the camera passes through hold full opacity to d = 1090-1150, */
    /* which is 3.6-4.2x — 89vw, 150vw and 82vw — so their edges leave the */
    /* viewport before they are let go and the border of the photograph    */
    /* genuinely stops existing. The four far marks are released at or     */
    /* below 1.05x, so they NEVER approach: that is what buys the empty    */
    /* stretches between the passes.                                       */
    /*                                                                     */
    /* A came down with it. The lateral drift is multiplied by the same    */
    /* scale, so at 3.6x the old 260vw run threw a dominant plate a whole  */
    /* screen sideways before it could own the frame.                      */
    var A = 130, B = 11000;
    /* Perspective, kept in step with .fld__stage. */
    var P = 1500;

    /* PORTRAIT KEEPS THE TRAVEL. It does not keep the numbers.
       A phone is a third of the width and twice the height, so the same
       lateral run throws a near plate clean off the side before it can
       own the frame, and the same release depth composites a layer four
       times a 390px viewport — which is a raster a phone should not be
       asked for. The travel, the stations and the rhythm are identical;
       the drift comes down and the plates are let go at about 2.2x, which
       on a portrait screen is still a plate crossing both edges.

       The alternative — the vertical cascade this used to fall back to —
       keeps the photographs and throws away the one thing the section is
       about, which is that the visitor is travelling through them. */
    var MOB = window.matchMedia('(max-width:860px)');
    function mobile() { return MOB.matches; }

    (function field() {
      var pin = document.querySelector('[data-fld]');
      if (!pin) return;
      var stage = pin.querySelector('.fld__stage');
      var deep = pin.querySelector('[data-fld-deep]');
      if (!stage || !deep) return;

      var plates = Array.prototype.slice.call(deep.querySelectorAll('.fld__pl'));
      var last = deep.querySelector('.fld__pl--last');
      var datumEl = pin.querySelector('[data-fld-datum]');
      var noEl = pin.querySelector('[data-fld-no]');
      var barEl = pin.querySelector('[data-fld-bar]');
      var cutEl = pin.querySelector('[data-fld-cut]');
      var veilEl = pin.querySelector('[data-fld-veil]');
      var allEl = pin.querySelector('.fld__all');

      var mob = mobile();
      if (mob) A = 46;

      plates.forEach(function (el) {
        var run = parseFloat(el.dataset.run) || 0;
        el.__run = run;
        el.__no = el.dataset.no || '';
        /* Authored release. Defaults match the far marks, so a plate added
           without the two attributes stays a distant one rather than
           silently becoming a 150vw event. */
        el.__near = el.dataset.near !== undefined ? +el.dataset.near : 120;
        el.__cull = el.dataset.cull !== undefined ? +el.dataset.cull : 420;
        el.__pass = el.classList.contains('fld__pl--near');
        if (mob && el.__pass) { el.__near = 820; el.__cull = 980; }
        /* World position: its station along the travel axis, plus the
           offset that gives it its own place in the composition. Depth is
           the station alone now — a separate dz only made the same number
           expressible two ways and the two disagreed. */
        el.style.setProperty('--x', (A * run + (+el.dataset.dx || 0)).toFixed(2));
        el.style.setProperty('--y', (+el.dataset.dy || 0).toFixed(2));
        el.style.setProperty('--z', (-B * run).toFixed(1));
        el.style.setProperty('--w', el.dataset.w || 20);
        el.style.setProperty('--h', el.dataset.h || 60);
      });

      /* THE DATUM PLANE.
         Stations at a constant interval of depth, from just in front of the
         camera to beyond the end of the run, each one a fragment of the
         same line. They travel with the field, so their world position is
         written once and only their depth opacity changes.

         x = A * (-z / B) puts every station ON the travel axis. Laid
         straight down the middle instead they would converge on the centre
         of the screen rather than on the point the camera is travelling
         towards, and the space would read as flat. */
      var marks = [];
      if (datumEl) {
        var step = +datumEl.dataset.step || 900;
        var n = +datumEl.dataset.n || 20;
        var frag = document.createDocumentFragment();
        for (var s = 0; s < n; s++) {
          var z = step - s * step;               // +step, 0, -step, -2*step...
          var mk = document.createElement('i');
          mk.__z = z;
          mk.style.setProperty('--z', z.toFixed(0));
          mk.style.setProperty('--x', (-A * z / B).toFixed(2));
          frag.appendChild(mk);
          marks.push(mk);
        }
        datumEl.appendChild(frag);
      }

      /* DEPTH FOG.
         The far edge is shared — it is where perspective has made anything
         too small to read. The near edge is the plate's own, because
         "released at 1.05x" and "released at 4.2x" are two completely
         different objects in the composition and the difference between
         them is the entire rhythm of the section. */
      function depthOpacity(d, near, cull) {
        if (d < -3800) return 0;
        if (d < -2900) return (d + 3800) / 900;
        if (d < near) return 1;
        if (d < cull) return 1 - (d - near) / (cull - near);
        return 0;
      }

      var lastNo = '';
      if (still) return;

      onFrame(function () {
        if (idle(pin) && !forced) return;
        var q = travel(pin, stage, 'fld');

        deep.style.transform =
          'translate3d(' + (-A * q).toFixed(3) + 'vw,0,' + (B * q).toFixed(1) + 'px)';

        /* The stage's own rule takes over from the crushed plate across
           .90-.96, while both are a 1px line of the same colour at the same
           height. Two complementary alphas of a 16% rule differ from one by
           at most 0.6% at the crossover — the swap cannot be seen, and
           after it the enormous composited layer can be dropped. */
        var hand = clamp((q - 0.93) / 0.025, 0, 1);

        /* THE CURRENT SHEET is the nearest plate that is actually on screen,
           not the nearest station in q. Those are not the same thing once
           the near plates hold to 4x: the rig would name a sheet the visitor
           can no longer see while a 150vw one crosses the frame. */
        var curEl = null, curD = -Infinity, veil = 0;
        for (var i = 0; i < plates.length; i++) {
          var el = plates[i];
          var d = B * (q - el.__run);
          var o = depthOpacity(d, el.__near, el.__cull);
          if (el === last) o *= 1 - hand;
          var vis = o > 0.004;
          if (el.__o !== o) {
            el.__o = o;
            el.style.opacity = o.toFixed(3);
          }
          /* Hidden, not merely transparent: a plate that has gone past the
             camera would otherwise still be composited at an enormous
             rasterised size for the rest of the run. */
          if (el.__v !== vis) {
            el.__v = vis;
            el.style.visibility = vis ? 'visible' : 'hidden';
          }
          /* The stage's veil only exists while a plate is big enough to BE
             the ground the rig is written on. Between 620 and 940 of depth
             a pass plate crosses from a picture standing in the space to
             the whole frame, and the veil crosses with it. */
          if (el.__pass && vis) veil = Math.max(veil, clamp((d - 620) / 320, 0, 1));
          if (vis && d > curD) { curD = d; curEl = el; }
        }
        if (veilEl && veilEl.__o !== veil) {
          veilEl.__o = veil;
          veilEl.style.opacity = veil.toFixed(3);
          /* One value, published on the stage, read by the veil and by the
             two labels at the head of the sheet. */
          stage.style.setProperty('--veil', veil.toFixed(3));
        }

        for (var m = 0; m < marks.length; m++) {
          var mk = marks[m];
          var md = mk.__z + B * q;
          /* Culled well before the plates are: a survey mark that sweeps
             past the camera at 4x is a bar across the screen. */
          var mo = md < -5200 ? 0 : md < -3800 ? (md + 5200) / 1400 * 0.5
                 : md < 260 ? 0.5 : md < 520 ? 0.5 * (1 - (md - 260) / 260) : 0;
          if (mk.__o !== mo) {
            mk.__o = mo;
            mk.style.opacity = mo.toFixed(3);
            mk.style.visibility = mo > 0.004 ? 'visible' : 'hidden';
          }
        }

        if (noEl && curEl && curEl.__no !== lastNo) {
          lastNo = curEl.__no;
          noEl.textContent = curEl.__no;
        }
        if (barEl) barEl.style.transform = 'scaleX(' + q.toFixed(4) + ')';

        /* THE SURVIVOR.
           The last plate does not fade out and it is not replaced: it is
           CRUSHED onto the datum plane. Over the closing beat its height
           goes to nothing while it spreads past both edges, and what is
           left of it is ONE LINE at --datum — which is the grade the first
           service is built on. Nothing is added at the boundary and nothing
           is cross-faded; the same object changes state and the next
           section opens with that object already in place.

           It finishes at q = .96 rather than at 1, so the last beat of the
           section is the bare line holding still. A survivor that is still
           being formed as the boundary arrives is not yet an object. */
        var k = ease(clamp((q - 0.84) / 0.09, 0, 1));
        if (last) {
          /* THE RESIDUE IS SOLVED, NOT GUESSED.
             The crushed plate has to end at exactly ONE DEVICE PIXEL of
             height, because the line that continues into SERVICES is a 1px
             CSS rule and a 2px photographic smear handing over to a 1px
             rule is a visible step in the one object that is supposed to
             survive. So the closing scale is computed from the plate's own
             rendered height and its perspective scale at this moment
             rather than from a tuned constant that is only correct at one
             viewport height. */
          var hPx = window.innerHeight * (+last.dataset.h || 60) / 100;
          var s = P / (P - B * (q - last.__run));
          var floor = clamp(1 / (hPx * s), 0.00001, 0.02);
          last.style.setProperty('--crush-y', (1 - k * (1 - floor)).toFixed(5));
          last.style.setProperty('--crush-x', (1 + k * 3.4).toFixed(4));
          /* And it stops being a photograph on the way down: by the time it
             is a hairline it is the hairline's own colour, so what survives
             the boundary is a rule and not a strip of colour that happens
             to be thin. */
          last.style.setProperty('--flat', k.toFixed(4));
          last.style.setProperty('--capo', clamp(1 - k * 4, 0, 1).toFixed(3));
        }
        if (cutEl) cutEl.style.opacity = hand.toFixed(4);
        if (allEl) toggle(allEl, 'is-on', q > 0.93);
      });

      /* Contextual pointer — over the field only, desktop only. */
      var cur = pin.querySelector('[data-fld-cur]');
      if (cur && fine && !reduced) {
        var x = 0, y = 0, cx = 0, cy = 0, raf = null;
        function follow() {
          cx += (x - cx) * 0.17; cy += (y - cy) * 0.17;
          cur.style.transform = 'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0)' +
            ' translate(-50%,-50%)' + (cur.classList.contains('is-on') ? ' scale(1)' : ' scale(.72)');
          raf = requestAnimationFrame(follow);
        }
        stage.addEventListener('pointermove', function (e) {
          x = e.clientX; y = e.clientY;
          if (!raf) { cx = x; cy = y; raf = requestAnimationFrame(follow); }
        });
        stage.addEventListener('pointerenter', function () { cur.classList.add('is-on'); });
        stage.addEventListener('pointerleave', function () {
          cur.classList.remove('is-on');
          if (raf) { cancelAnimationFrame(raf); raf = null; }
        });
        /* The plates are the site's work, and the archive is where it
           lives — clicking anywhere on the field goes there. */
        stage.addEventListener('click', function (e) {
          if (e.target.closest('a')) return;
          location.href = 'referenciak.html';
        });
      }
    })();

    /* ---------------------------------------------------------------- */
    /* 12.3 — LANDSCAPE LAYERS  (services)                  [2.3 REBUILT] */
    /* ---------------------------------------------------------------- */
    /* NOT THREE SLIDES. One piece of land, transformed three times.      */
    /*                                                                    */
    /* Phase 2.2 gave each service its own drawing and moved the type     */
    /* past them. Three drawings in one style are still three drawings,   */
    /* and the section read as 01 / 02 / 03 with graphics behind the      */
    /* words. What the section says is that the three services are three  */
    /* views of the same ground, so it is now literally that: one         */
    /* instance of the world in §14, one camera travelling through it,    */
    /* and components arriving on it.                                     */
    /*                                                                    */
    /*   01 KERTÉPÍTÉS       the inherited line acquires terrain, then    */
    /*                       depth, then a built surface. A DRAWING       */
    /*                       BECOMES TERRAIN, and that is visible with    */
    /*                       every word on the screen muted.              */
    /*   02 ÖNTÖZŐRENDSZER   the same ground, opened. Nothing resets:     */
    /*                       the camera lowers into the cut it has just   */
    /*                       built and the network is inside it.          */
    /*   03 FELSZÍN ALATTI   the camera goes UNDER. Grade leaves through  */
    /*                       the top of the viewport and the frame is     */
    /*                       root zone, dripline and wetted soil.         */
    (function layers() {
      var sec = document.querySelector('.lyr');
      if (!sec) return;
      var stage = sec.querySelector('.lyr__stage');
      var items = Array.prototype.slice.call(sec.querySelectorAll('.lyr__it'));
      var host = sec.querySelector('[data-lyr-world]');
      var iEl = sec.querySelector('[data-lyr-i]');
      var tone = sec.querySelector('[data-lyr-tone]');
      if (!stage || !items.length) return;

      /* THE CAMERA.
         q, x along the section, world height in frame, the world height
         that is anchored, and where on the screen that anchor sits.

         The first key is the contract with PROJECTS: grade at 46% of the
         viewport is exactly where the last plate was crushed, so the
         section opens on that line already in place. Change --datum in
         rk.css and this .46 has to move with it. */
      var CAM = [
        [0.00, 600, 640,  0, 0.46],   // the rule inherited from PROJECTS
        [0.10, 610, 620,  0, 0.62],   // the camera lifts: sky opens for the type
        [0.19, 620, 590,  0, 0.70],   // 01 · reading. terrain in the lower third
        [0.30, 620, 520,  0, 0.54],   // 01 · the ground rises into the frame
        [0.40, 600, 430,  0, 0.30],   // the camera drops toward grade
        [0.46, 592, 300,  0, 0.32],   // the section opens under the surface
        /* 02 KEEPS THE SURFACE IN FRAME, AND THAT IS THE POINT OF IT.
           The whole claim of this service is that the ground the visitor
           has just watched being built CONTAINS a system, so grade stays
           at the top of the screen with its turf on it while the main,
           the laterals and the emitters run across the middle. Take the
           surface away here and the section is about pipes; leave it in
           and the section is about a garden with pipes under it.

           The build-up is only 152 units deep and the network sits in the
           top 62 of them, so the frame has to hold both — 215 units is
           the height at which grade lands at 20% and the dripline at 49%,
           which is the only framing where the type column, the surface
           and the system are all somewhere the eye can go. */
        [0.52, 585, 215,  0, 0.20],   // 02 · the network at working scale
        [0.68, 545, 180, 30, 0.10],   // lowering; grade leaves the frame
        [0.86, 505, 150, 62, 0.30],   // 03 · under grade entirely
        [1.00, 460, 130, 62, 0.32]    // 03 · inside the root zone
      ];

      /* PORTRAIT. Two to four metres of the same section instead of
         twelve, with each state framed on its own subject: the ground
         forming, the paved edge, one emitter, one wetting lens. The
         transformations are identical — only the crop of the world the
         camera holds is authored differently. */
      var CAM_M = [
        [0.00, 560, 620,  0, 0.46],
        [0.10, 560, 560,  0, 0.60],
        [0.19, 545, 470,  0, 0.66],   // 01 · terrain in the lower third
        [0.30, 540, 380,  0, 0.52],   // 01 · the ground rises
        [0.40, 520, 300,  0, 0.30],
        [0.46, 500, 260,  0, 0.10],
        [0.52, 470, 210,  0, 0.16],   // 02 · one emitter and its lateral
        [0.68, 455, 190, 24, 0.08],
        [0.86, 445, 165, 62, 0.30],   // 03 · under grade
        [1.00, 440, 132, 62, 0.34]    // 03 · the root zone
      ];

      var world = host && RK_WORLD.mount(host, {
        cam: CAM,
        camMob: CAM_M,
        /* THE TRANSFORMATION. Relief first, then depth — the line gains
           the SHAPE of the ground before it gains the substance of it,
           which is the order a survey actually happens in. */
        relief: [0.04, 0.20],
        depth:  [0.09, 0.28],
        /* No tech and no hatch anywhere in SERVICES: this section's whole
           claim is that the ground is REAL. The technical register belongs
           to PROCESS, which is where the same cut is drawn rather than
           dug. */
        layers: {
          grade:   RK_WORLD.ALWAYS,   // the object inherited from PROJECTS
          /* The survey is its OWN beat and it is over before the first
             service is read. Held longer, its hairlines crossed the
             description paragraph — and a technical line through a
             sentence is the cheapest way there is to make a page look
             unfinished. */
          contour: [0.02, 0.06, 0.12, 0.17],
          measure: [0.03, 0.07, 0.13, 0.18],
          cutfill: [0.10, 0.17, 0.30, 0.36],
          strata:  [0.09, 0.26],
          bounds:  [0.09, 0.26],
          ends:    [0.15, 0.27],
          grit:    [0.21, 0.31],
          turf:    [0.25, 0.35],
          pave:    [0.27, 0.37],
          /* The network is COMPLETE by the point the second service is
             being read, not half built. Arriving on the reading beat, it
             was still assembling itself behind the paragraph that
             describes it. */
          main:    [0.36, 0.43],
          lat:     [0.40, 0.47],
          drip:    [0.44, 0.50],
          wet:     [0.53, 0.63],
          root:    [0.62, 0.74],
          notes:   [0.82, 0.90]
        },
        /* WATER TRAVELS. The five lenses do not appear together — the
           charge reaches each emitter in turn from the source end of the
           run, so what the visitor sees is pressure moving through a
           system and soil taking it up, rather than five identical
           shapes switching on. No glow, no particle, nothing luminous:
           the only thing that changes is how wet the ground is. */
        after: function (q, host, groups) {
          var g = groups.wet;
          if (!g || g.style.visibility === 'hidden') return;
          var lens = g.children;
          for (var i = 0; i < lens.length; i++) {
            var o = clamp((q - (0.53 + i * 0.022)) / 0.05, 0, 1);
            if (lens[i].__o !== o) {
              lens[i].__o = o;
              lens[i].style.opacity = o.toFixed(3);
            }
          }
        }
      });

      var n = items.length, lastI = -1;

      /* The composed still: the ground built, the sky open, the light
         register — the one frame that says "a drawing became terrain"
         without anything having to move. */
      if (still) { if (world) world.set(0.30); toggle(stage, 'is-under', false); return; }

      onFrame(function () {
        if (idle(sec) && !forced) return;
        var q = travel(sec, stage, 'lyr');
        if (world) world.set(q);

        for (var i = 0; i < n; i++) {
          /* See ASSEMBLY below for why this is 2.0 and not a taste value. */
          var s = presence(q, i, n, 2.0);
          var it = items[i];
          if (it.__o !== s.o) {
            it.__o = s.o;
            it.style.opacity = s.o.toFixed(3);
            it.style.visibility = s.o > 0.004 ? 'visible' : 'hidden';
            /* Displaced, not faded: the state leaving is pushed up out of
               the frame by the one arriving from below.
               The -50% has to be carried here — an inline transform replaces
               the rule's translateY(-50%) outright, and without it the tall
               third state hangs off the bottom of the stage. */
            it.style.transform =
              'translate3d(0,calc(-50% + ' + (-s.u * 24).toFixed(2) + 'svh),0)';
          }
        }

        /* THE PAGE CROSSES GRADE TWICE, AND THE SECOND CROSSING IS THE
           WHOLE SECTION.

           It OPENS in the project field's own dark, because the line it
           opens on is the field's last object and a rule that changes
           colour at a section edge is two rules, not one. It comes up
           into limestone while KERTÉPÍTÉS builds the ground under an open
           sky. And between 01 and 02 it goes under and STAYS under,
           because that is where the other two services happen.

           This is also what makes the section legible. The world fills
           the frame, so at the moment the camera is inside the ground
           there is no sky left to set type against — and dark type on
           subsoil is not type. Inverting the register is not a
           workaround for that: it is the same fact, which is that the
           visitor is now underground.

           Both changes are scheduled into the gaps between states, where
           no line of type is at full opacity, so the visitor feels the
           register change rather than watching it happen to a paragraph
           they are in the middle of reading. */
        var lit = ease(clamp((q - 0.05) / 0.09, 0, 1)) *
                  (1 - ease(clamp((q - 0.34) / 0.10, 0, 1)));
        if (tone) tone.style.opacity = (1 - lit).toFixed(3);
        toggle(stage, 'is-under', lit < 0.5);
        sec.dataset.tone = lit < 0.5 ? 'dark' : 'light';

        /* TYPE GIVES WAY AT THE PEAK OF EACH TRANSFORMATION.
           A monumental service name and a piece of ground becoming
           terrain are two events competing for the same screen. The name
           is not removed — it is the section's content and it stays
           readable — but it steps back while the ground moves, and comes
           forward again when the ground has settled. */
        /* Each peak is scheduled BETWEEN the reading beats, never on one.
           The three states are centred at .17, .50 and .83; a peak that
           lands on a centre dims the paragraph the visitor came here to
           read, which is the opposite of what stepping the type back is
           for. */
        var peak = Math.max(
          band3(q, 0.24, 0.29, 0.34, 0.40),   // 01 · the ground rising
          band3(q, 0.55, 0.60, 0.64, 0.70),   // 02 · water propagating
          band3(q, 0.70, 0.76, 0.82, 0.88)    // 03 · the descent under grade
        );
        stage.style.setProperty('--type', (1 - peak * 0.62).toFixed(3));

        var cu = Math.min(n - 1, Math.max(0, Math.round(q * n - 0.5)));
        if (cu !== lastI) {
          lastI = cu;
          if (iEl) iEl.textContent = '0' + (cu + 1);
        }
      });
    })();

    /* ---------------------------------------------------------------- */
    /* 12.4 — ASSEMBLY  (process)                                        */
    /* ---------------------------------------------------------------- */
    /* The cut the third service opened is now the datum. The visitor      */
    /* travels along it and the garden is REBUILT underneath, one          */
    /* component per station — site line, measurement, ground section,     */
    /* irrigation and planting, finished surface. The section also crosses */
    /* back to the light register as the surface goes on, so the colour is */
    /* telling the same story as the drawing.                             */
    (function assembly() {
      var sec = document.querySelector('.asm');
      if (!sec) return;
      var stage = sec.querySelector('.asm__stage');
      var datum = sec.querySelector('.asm__datum');
      var mark = sec.querySelector('[data-asm-head]');
      var tone = sec.querySelector('[data-asm-tone]');
      var stations = Array.prototype.slice.call(sec.querySelectorAll('.asm__stations li'));
      var steps = Array.prototype.slice.call(sec.querySelectorAll('.asm__step'));
      var host = sec.querySelector('[data-asm-world]');
      if (!stage || !steps.length) return;

      /* THE CAMERA.
         Opens on the exact frame SERVICES closed on — 130 world units,
         inside the root zone — and the first thing it does is pull back
         until the whole twelve metres is in view. That pull-back IS the
         SERVICES -> PROCESS transformation: the physical cut the visitor
         was standing in becomes the technical representation of that cut,
         without the world moving underneath them.

         The last key is the payoff. The camera RISES: the section drops
         to the foot of the frame, the air above it opens, and what is
         left on screen is a finished garden surface seen from above
         grade — the composition the page opened with. */
      var CAM = [
        [0.00, 460, 130, 62, 0.32],   // inherited from SERVICES, exactly
        [0.08, 540, 380, 20, 0.30],   // pulling back out of the ground
        [0.16, 600, 640,  0, 0.52],   // 01 · the site line, and nothing else
        [0.30, 600, 620,  0, 0.52],   // 02 · measured
        [0.42, 600, 560,  0, 0.48],
        [0.50, 600, 480,  0, 0.46],   // 03 · reading
        /* THE DOMINANT FRAME. 152 units of build-up in a 330-unit view
           puts the constructed ground across half the screen and takes it
           off both edges. It is scheduled BETWEEN stations 03 and 04, on
           the beat where the written stage has already left — which is
           the only moment the drawing can have the whole viewport. */
        [0.60, 590, 330,  0, 0.28],   // 03 -> 04 · the section owns the frame
        [0.70, 585, 360,  0, 0.32],   // 04 · infrastructure assembling
        [0.82, 588, 400,  0, 0.36],
        [0.90, 595, 470,  0, 0.44],   // 05 · the surface completes
        [1.00, 610, 640,  0, 0.74]    // 05 · THE CAMERA RISES
      ];

      var CAM_M = [
        [0.00, 440, 132, 62, 0.34],   // inherited from SERVICES
        [0.08, 480, 300, 20, 0.32],
        [0.16, 560, 560,  0, 0.54],   // 01 · the site line
        [0.30, 560, 540,  0, 0.54],   // 02 · measured
        [0.42, 555, 470,  0, 0.50],
        [0.50, 550, 400,  0, 0.48],   // 03 · reading
        [0.60, 545, 280,  0, 0.28],   // 03 -> 04 · the section owns the frame
        [0.70, 540, 300,  0, 0.32],   // 04 · assembling
        [0.82, 545, 340,  0, 0.36],
        [0.90, 550, 400,  0, 0.44],   // 05 · the surface completes
        [1.00, 560, 560,  0, 0.74]    // 05 · the rise
      ];

      var world = host && RK_WORLD.mount(host, {
        cam: CAM,
        camMob: CAM_M,
        /* Relief is inherited and never leaves — it is the same piece of
           land. DEPTH is un-built and re-built: the section arrives fully
           constructed from SERVICES, is stripped back to a survey line
           over the first sixth of the run, and is then assembled again
           WITH ITS MEASUREMENTS. That is the difference between a garden
           and a garden somebody planned. */
        relief: RK_WORLD.ALWAYS,
        depth:  function (q) {
          /* Arrives built, is stripped to the survey line by .13, and is
             re-excavated and re-filled across station 03. */
          return q < 0.28 ? 1 - clamp((q - 0.04) / 0.09, 0, 1)
                          : clamp((q - 0.42) / 0.12, 0, 1);
        },
        tech:   [0.03, 0.14, 0.66, 0.94],
        layers: {
          grade:   RK_WORLD.ALWAYS,
          /* 01 · FELMÉRÉS — existing condition, and nothing else. */
          contour: [0.12, 0.18, 0.44, 0.52],
          /* 02 · TERV ÉS AJÁNLAT — graphic measurement. No figures. */
          /* Out again for the payoff: dimension apparatus over a finished
             lawn is a drawing nobody has taken the setting-out off. */
          measure: [0.24, 0.31, 0.86, 0.93],
          cutfill: [0.28, 0.35, 0.58, 0.66],
          /* 03 · TEREP ÉS TALAJMUNKA — the drawing acquires depth. */
          strata:  [0.42, 0.52],
          hatch:   [0.42, 0.52],   // multiplied by --tech; see mount()
          bounds:  [0.42, 0.50],
          ends:    [0.46, 0.54],
          grit:    [0.50, 0.58],
          /* 04 · KIVITELEZÉS — infrastructure enters the ground. */
          main:    [0.62, 0.68],
          lat:     [0.65, 0.71],
          drip:    [0.68, 0.74],
          root:    [0.72, 0.79],
          wet:     [0.74, 0.80],
          /* 05 · ÁTADÁS — the finished surface. */
          turf:    [0.83, 0.90],
          pave:    [0.85, 0.92]
        },
        /* DEPTH IS RE-BUILT FROM THE TOP DOWN. The strata do not appear
           together: each one settles into place as the excavation is
           filled, which is the order the work actually happens in and
           the reason this reads as construction rather than as a
           cross-fade between two drawings. */
        after: function (q, host, groups) {
          var g = groups.strata;
          if (!g || g.style.visibility === 'hidden') return;
          var st = g.children;
          for (var i = 0; i < st.length; i++) {
            var o = clamp((q - (0.42 + (st.length - 1 - i) * 0.022)) / 0.06, 0, 1);
            if (st[i].__o !== o) { st[i].__o = o; st[i].style.opacity = o.toFixed(3); }
          }
        }
      });

      var n = steps.length, lastSt = -2;

      /* The datum's length is measured, not assumed: it is inset by the
         page gutter on desktop and runs vertically on a phone. */
      function measure() {
        if (!datum || !mark) return;
        var r = datum.getBoundingClientRect();
        mark.style.setProperty('--dw', r.width.toFixed(1) + 'px');
        mark.style.setProperty('--dh', r.height.toFixed(1) + 'px');
      }
      measure();
      window.addEventListener('resize', measure, { passive: true });

      /* The composed still: the section fully assembled and back in the
         light — every station's component on the drawing at once, which
         is what the five stations add up to. */
      if (still) {
        if (world) world.set(0.90);
        toggle(stage, 'is-lit', true);
        sec.dataset.tone = 'light';
        for (var k0 = 0; k0 < stations.length; k0++) toggle(stations[k0], 'is-done', true);
        return;
      }

      onFrame(function () {
        if (idle(sec) && !forced) return;
        var q = travel(sec, stage, 'asm');
        if (world) world.set(q);

        if (mark) mark.style.setProperty('--mq', q.toFixed(4));

        for (var i = 0; i < n; i++) {
          /* EXACTLY 2.0, and the number is not arbitrary. A slot's window
             reaches zero at |u| = 1/width, and adjacent centres are 1 apart
             in u — so 2.0 is the one value at which the outgoing stage hits
             zero at precisely the moment the incoming one leaves it. Wider
             and the datum has stretches with no written stage on it at all;
             narrower and two stages are legible on top of each other at the
             same origin, which is what a double exposure looks like. */
          var s = presence(q, i, n, 2.0);
          var st = steps[i];
          if (st.__o !== s.o) {
            st.__o = s.o;
            st.style.opacity = s.o.toFixed(3);
            st.style.visibility = s.o > 0.004 ? 'visible' : 'hidden';
            st.style.transform = 'translate3d(0,' + (s.u * 26).toFixed(2) + 'px,0)';
          }
        }

        var cur = Math.min(n - 1, Math.max(0, Math.floor(q * n)));
        if (cur !== lastSt) {
          lastSt = cur;
          for (var k = 0; k < stations.length; k++) {
            toggle(stations[k], 'is-live', k === cur);
            toggle(stations[k], 'is-done', k < cur);
          }
          /* A COMPONENT IS ADDED, NOTHING IS REPLACED. The world's own
             schedule does this now — every layer that has been reached
             stays on the drawing, which is what makes this an assembly
             rather than five slides. */
        }

        /* THE PAGE COMES INTO THE LIGHT WHEN THE CUT BECOMES A DRAWING.
           The section starts under grade, on the soil the third service
           left the page in, and the register turns to paper over the same
           stretch in which the camera pulls out of the ground and the
           world crosses to its technical form. That is one event, not
           two: a physical cut becoming the technical representation of
           that cut IS the page going from soil to paper.

           In 2.2 this happened between stations 04 and 05 and the whole
           assembly was therefore documented in the dark — hairlines and
           hatching on near-black, which is the one register a
           construction drawing cannot be read in. */
        var lit = clamp((q - 0.06) / 0.10, 0, 1);
        if (tone) tone.style.opacity = ease(lit).toFixed(3);
        toggle(stage, 'is-lit', lit > 0.5);
        sec.dataset.tone = lit > 0.5 ? 'light' : 'dark';

        /* Same discipline as SERVICES: the written stage steps back at
           the two beats where the drawing is doing something the visitor
           should be watching — the section acquiring depth, and the
           camera rising out of it at the end. */
        stage.style.setProperty('--type', (1 - 0.76 * Math.max(
          /* Between the reading beats, never on one: the five stations
             are centred at .1 .3 .5 .7 and .9. */
          band3(q, 0.56, 0.60, 0.64, 0.68),   // 03 -> 04 · the ground built
          band3(q, 0.93, 0.96, 1.00, 1.02)    // 05 · the rise
        )).toFixed(3));
      });
    })();

    /* ---------------------------------------------------------------- */
    /* 12.5 — PROOF  (trust)                                [2.3 REBUILT] */
    /* ---------------------------------------------------------------- */
    /* THE GARDEN PROVES THE CLAIM.                                       */
    /*                                                                    */
    /* Phase 2.2's own report named this the least finished section on    */
    /* the page, and it was right: a number, a rule and white space, with */
    /* nothing left if you took the number away. It was the one section   */
    /* whose idea was entirely typographic, and the only part of the      */
    /* page's own vocabulary in it was the word "grade" in a stylesheet.  */
    /*                                                                    */
    /* It is now the SAME WORLD as SERVICES and PROCESS, used as an       */
    /* instrument. The section, the grade line, the strata and the        */
    /* system are persistent; what each statement changes is how they are */
    /* being measured:                                                    */
    /*                                                                    */
    /*   EGY CSAPAT     four trades' lines enter mis-registered and       */
    /*                  resolve onto one datum. Coordination drawn as     */
    /*                  coordination, not as people.                      */
    /*   40 KM          the camera rises until the section is a horizon   */
    /*                  and a measured radius grows across the ground.    */
    /*                  A radius, not a map: nothing is named, because    */
    /*                  the source material supports a distance and does  */
    /*                  not support a place.                              */
    /*   70%            two sections of the SAME soil, side by side. The  */
    /*                  mechanism behind the claim — where the water      */
    /*                  ends up and where the roots are — not the number, */
    /*                  which is the copy's job and stays qualified       */
    /*                  there.                                            */
    /*   1 MUNKANAP     one working day as a shadow crossing the finished */
    /*                  surface. No sun, no sunrise.                      */
    /*   GARANCIA       the instrument resolves back to one section and   */
    /*                  one line, and that line is what FAQ opens on.     */
    (function proof() {
      var pin = document.querySelector('.prf__pin');
      if (!pin) return;
      var stage = pin.querySelector('.prf__stage');
      var slots = Array.prototype.slice.call(pin.querySelectorAll('.prf__slot'));
      var iEl = pin.querySelector('[data-prf-i]');
      var host = pin.querySelector('[data-prf-world]');
      if (!stage || !slots.length) return;

      /* Opens on the exact frame PROCESS closed on. */
      var CAM = [
        [0.00, 610, 640,  0, 0.74],   // inherited: the finished surface
        [0.10, 600, 620,  0, 0.62],   // 01 · EGY CSAPAT
        [0.22, 600, 820,  0, 0.62],   // rising
        /* 900, not 2400. Pulled far enough back for the section to read as
           a horizon and no further: at the height I tried first the whole
           measurement sat as a small mark in the middle of an empty page,
           which is the generic-KPI composition this section exists to get
           rid of. The RADIUS does the expanding here, not the camera. */
        [0.30, 600, 900,  0, 0.56],   // 02 · 40 KM — the section is a horizon
        [0.42, 600, 620,  0, 0.60],   // coming back down
        [0.50, 600, 540,  0, 0.60],   // 03 · 70% — two sections of one soil
        /* One beat where the comparison owns the frame, scheduled after
           the claim has been read and before the next one arrives. */
        /* 560, not 380. Both halves of the comparison have to be complete
           in one frame — a comparison you have to scroll between is not a
           comparison — and 896 world units across is the narrowest view
           that holds 240-960 with air at the edges. */
        [0.58, 600, 560,  0, 0.30],   // 03 · the mechanism, at full size
        [0.70, 600, 560,  0, 0.60],   // 04 · 1 MUNKANAP
        [0.90, 600, 900,  0, 0.58],   // 05 · resolving
        [1.00, 600, 1900, 0, 0.52]    // 05 · one line again -> FAQ
      ];

      /* A statement's own window. Every layer in this section is quoted
         against the five slot centres at .1 .3 .5 .7 and .9, so a
         component belongs to a CLAIM rather than to a stretch of scroll. */
      function ST(a, b, c, d) { return function (q) { return band3(q, a, b, c, d); }; }

      /* On a phone the two-section comparison cannot sit side by side —
         470 world units of frame will not hold 720 of drawing. The camera
         travels from one section to the other instead, which is the same
         comparison made in TIME rather than in space, and it is the one
         place on the page where a phone gets a move a desktop does not. */
      var CAM_M = [
        [0.00, 560, 560,  0, 0.74],
        [0.10, 550, 520,  0, 0.62],   // 01 · EGY CSAPAT
        [0.22, 570, 700,  0, 0.62],
        [0.30, 600, 900,  0, 0.56],   // 02 · 40 KM
        [0.42, 480, 560,  0, 0.60],
        [0.50, 400, 430,  0, 0.60],   // 03 · the surface-watered section
        [0.58, 800, 400,  0, 0.34],   // 03 · and the one with the line in it
        [0.70, 620, 470,  0, 0.60],   // 04 · 1 MUNKANAP
        [0.90, 600, 800,  0, 0.58],
        [1.00, 600, 1900, 0, 0.52]
      ];

      var world = host && RK_WORLD.mount(host, {
        cam: CAM,
        camMob: CAM_M,
        relief: RK_WORLD.ALWAYS,
        depth:  RK_WORLD.ALWAYS,
        /* The instrument reads more technically the further it is from
           the ground: nearly a drawing while the radius is being
           measured, nearly soil while the two sections are compared. */
        tech: function (q) {
          return 0.34 + 0.46 * band3(q, 0.20, 0.28, 0.36, 0.44)
                      - 0.24 * band3(q, 0.44, 0.50, 0.60, 0.66)
                      + 0.30 * band3(q, 0.88, 0.94, 1.02, 1.04);
        },
        layers: {
          grade:   RK_WORLD.ALWAYS,
          /* The ground itself is persistent, and only stands down while
             the camera is too far away for a stratum to mean anything. */
          strata:  function (q) { return Math.max(ST(-1, -1, 0.20, 0.26)(q), ST(0.42, 0.48, 0.86, 0.94)(q)); },
          bounds:  function (q) { return Math.max(ST(-1, -1, 0.20, 0.26)(q), ST(0.42, 0.48, 0.86, 0.94)(q)); },
          turf:    function (q) { return Math.max(ST(-1, -1, 0.20, 0.26)(q), ST(0.42, 0.48, 0.90, 0.97)(q)); },
          pave:    function (q) { return Math.max(ST(-1, -1, 0.20, 0.26)(q), ST(0.44, 0.50, 0.90, 0.97)(q)); },
          grit:    ST(0.44, 0.52, 0.86, 0.94),
          main:    ST(0.46, 0.52, 0.82, 0.88),
          lat:     ST(0.46, 0.52, 0.82, 0.88),
          drip:    ST(0.46, 0.52, 0.82, 0.88),
          wet:     ST(0.48, 0.54, 0.82, 0.88),
          root:    ST(0.46, 0.52, 0.82, 0.88),
          conv:    [0.02, 0.07, 0.16, 0.21],
          radius:  [0.23, 0.29, 0.37, 0.43],
          compare: [0.44, 0.50, 0.60, 0.66],
          day:     [0.63, 0.69, 0.80, 0.86],
          measure: [0.88, 0.94]
        },
        after: function (q, host, groups) {
          /* EGY CSAPAT. Four lines resolving onto one. The residual is
             the whole statement: at 1 they are four separate drawings,
             at 0 they are the section. */
          var res = 1 - clamp((q - 0.045) / 0.075, 0, 1);
          var cv = groups.conv;
          if (cv && cv.style.visibility !== 'hidden' && cv.__r !== res) {
            cv.__r = res;
            for (var i = 0; i < cv.children.length; i++) {
              var u = cv.children[i];
              u.setAttribute('transform',
                'translate(' + (+u.dataset.dx * res).toFixed(1) + ',' +
                               (+u.dataset.dy * res).toFixed(1) + ') rotate(' +
                               (+u.dataset.r * res).toFixed(2) + ' 600 0)');
            }
          }

          /* 40 KM. The radius grows outward. Each ring is scaled from the
             service point, so what the visitor sees is one measurement
             being taken rather than four circles appearing. */
          var rg = groups.radius;
          if (rg && rg.style.visibility !== 'hidden') {
            var reach = clamp((q - 0.245) / 0.085, 0, 1);
            if (rg.__r !== reach) {
              rg.__r = reach;
              /* THE MEASUREMENT EXPANDS, the camera barely moves. A radius
                 that grows from the service point across the ground is a
                 distance being measured; a camera that zooms out from a
                 fixed circle is a picture getting smaller. */
              var sc = (0.16 + 0.84 * reach).toFixed(4);
              var cy = RK_WORLD.P(600);
              rg.setAttribute('transform',
                'translate(600 ' + cy.toFixed(1) + ') scale(' + sc + ') translate(-600 ' + (-cy).toFixed(1) + ')');
              for (var r = 0; r < rg.children.length; r++) {
                var el2 = rg.children[r];
                var f = +el2.dataset.f;
                if (!f) continue;
                var o = clamp((reach - f * 0.62) * 5, 0, 1);
                if (el2.__o !== o) { el2.__o = o; el2.style.opacity = o.toFixed(3); }
              }
            }
          }

          /* 70%. The system belongs to the RIGHT-hand section only: on the
             left the water was put on the surface, and a dripline under
             the half of the drawing that is meant to show what happens
             WITHOUT one would be the comparison arguing against itself. */
          var half = q > 0.42 && q < 0.66;
          ['main', 'lat', 'drip', 'wet', 'root'].forEach(function (k) {
            var g = groups[k];
            if (!g || g.__half === half) return;
            g.__half = half;
            /* world is still being constructed on the first call — mount()
               runs set(0) before it returns — and at q = 0 this is never
               the half state anyway. */
            if (half && world) g.setAttribute('clip-path', world.clip);
            else g.removeAttribute('clip-path');
          });

          /* 1 MUNKANAP. One shadow, from the paving's own edge, from one
             side of the garden to the other. --day is the day. */
          var dg = groups.day;
          if (dg && dg.style.visibility !== 'hidden') {
            var day = clamp((q - 0.645) / 0.15, 0, 1);
            if (dg.__d !== day) {
              dg.__d = day;
              /* Long, short, long — and it changes side at noon. */
              var now = (day - 0.5) * 2;                     // -1 .. 1
              dg.querySelectorAll('.wrl__shadow').forEach(function (p) {
                var o = 0.16 + 0.84 * clamp(1 - Math.abs(+p.dataset.t - now) * 2.4, 0, 1);
                p.style.opacity = o.toFixed(3);
              });
              dg.querySelector('.wrl__daymk').setAttribute('cx', (180 + 840 * day).toFixed(1));
            }
          }
        }
      });

      var n = slots.length, lastI = -1;

      /* The composed still: the two-section comparison, which is the one
         state here that carries an argument rather than a measurement. */
      if (still) { if (world) world.set(0.52); return; }

      onFrame(function () {
        if (idle(pin) && !forced) return;
        var q = travel(pin, stage, 'prf');
        if (world) world.set(q);
        for (var i = 0; i < n; i++) {
          /* 2.6 leaves roughly a quarter of every slot at nothing at all.
             That emptiness is the section's whole argument. */
          var s = presence(q, i, n, 2.6);
          var el = slots[i];
          if (el.__o === s.o) continue;
          el.__o = s.o;
          el.style.opacity = s.o.toFixed(3);
          el.style.visibility = s.o > 0.004 ? 'visible' : 'hidden';
          el.style.transform = 'translate3d(0,calc(-100% + ' + (-s.u * 7).toFixed(2) + 'svh),0)';
        }
        /* Same discipline as the two sections above: the claim steps back
           on the one beat where the instrument is doing something worth
           watching. It is scheduled between the third and fourth
           statements, never on a statement's own centre. */
        stage.style.setProperty('--type',
          (1 - 0.72 * band3(q, 0.545, 0.575, 0.60, 0.635)).toFixed(3));

        var cu = Math.min(n - 1, Math.max(0, Math.round(q * n - 0.5)));
        if (cu !== lastI) { lastI = cu; if (iEl) iEl.textContent = '0' + (cu + 1); }
      });
    })();
  })();

  /* ================================================================== */
  /* 13 — HEADER: THE SECTION UNDERNEATH DECIDES                        */
  /* ------------------------------------------------------------------ */
  /* Phase 2.2 gives the homepage a tonal rhythm that changes DURING     */
  /* sections rather than at their edges, so "solid after the hero" is   */
  /* no longer a description of anything. The bar reads the tone of      */
  /* whatever is actually under it — including the two stages that       */
  /* rewrite their own [data-tone] as they cross grade — and over the    */
  /* Living Ground it drops its sheet entirely.                          */
  /* ================================================================== */
  (function headerTone() {
    var bar = document.querySelector('.rk-nav');
    if (!bar || bar.classList.contains('is-locked')) return;
    var zones = document.querySelectorAll('[data-tone]');
    if (!zones.length) return;          // pages that predate this: §04 stands

    var wasDark = true, wasFilm = false;
    onFrame(function () {
      var probe = bar.offsetHeight * 0.5;
      var dark = wasDark, film = wasFilm, found = false;
      for (var i = 0; i < zones.length; i++) {
        var r = zones[i].getBoundingClientRect();
        if (r.top <= probe && r.bottom > probe) {
          dark = zones[i].dataset.tone === 'dark';
          film = zones[i].hasAttribute('data-film');
          found = true;
        }
      }
      /* Nothing under the bar means the probe has landed in a hairline gap
         between two sections — a collapsed margin, a rounding error. The
         answer there is "whatever it was a pixel ago", never a default:
         defaulting flashed the header to its dark state for one frame in
         the middle of a run of light sections. */
      if (found) { wasDark = dark; wasFilm = film; }
      bar.classList.toggle('is-solid', !dark);
      bar.classList.toggle('is-film', film);
    });
  })();

  /* ================================================================== */
  /* 11 — PAGE TRANSITION                                               */
  /* ------------------------------------------------------------------ */
  /* A 260ms wipe on the way out, and nothing else. Navigation stays     */
  /* entirely native: no routing, no history manipulation, no fetch.     */
  /* Anything that is not a plain left-click on a same-document-type     */
  /* internal link is handed straight back to the browser.               */
  /* ================================================================== */
  (function pageWipe() {
    if (reduced) return;
    var wipe = document.querySelector('.rk-wipe');
    if (!wipe) return;

    document.addEventListener('click', function (e) {
      if (e.defaultPrevented) return;
      // Modifier / middle / right clicks must keep their native behaviour.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      // SVG and shadow targets do not always carry closest().
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a || !a.href) return;
      if (a.target && a.target !== '_self') return;
      if (a.hasAttribute('download')) return;

      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      if (/^(mailto:|tel:|javascript:)/i.test(href)) return;

      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;
      // Same page, different hash — let the browser scroll.
      if (url.pathname === location.pathname && url.search === location.search) return;

      e.preventDefault();
      wipe.classList.add('is-out');
      window.setTimeout(function () { location.href = a.href; }, 260);
    });

    // Returning via the back/forward cache would otherwise restore a page
    // still covered by the wipe sheet.
    window.addEventListener('pageshow', function () { wipe.classList.remove('is-out'); });
  })();
})();
