#!/usr/bin/env node
/* ============================================================================
   COLD-LOAD REGRESSION — THE FOOTER IS THE END OF THE DOCUMENT
   ----------------------------------------------------------------------------
   Guards one invariant: once the page has settled, nothing hangs below the
   footer. document.scrollHeight and the footer's bottom edge are the same
   number, give or take the rounding the two are allowed.

   WHY THIS TEST EXISTS, AND WHY IT DELAYS THE STYLESHEET.
   The built site ships its CSS as

     <link rel="preload" as="style" onload="this.rel='stylesheet'">

   which is applied ASYNCHRONOUSLY, while rk.js ships `defer` — and defer waits
   for the DOM, not for a stylesheet that is not blocking anything. So on the
   built site the reader can and does run against an UNSTYLED document. Over a
   warm localhost that race is never lost, which is exactly why a warm run is
   worthless as a regression test: the broken build passes it every time.

   So each case delays ONLY the CSS response, by --delay ms. Nothing else is
   touched — the JS, the HTML and the images arrive at their usual speed. That
   makes the loser of the race the loser every time, and the test deterministic
   in the direction that matters: it fails when the bug is present.

   Any geometry a reader writes before the stylesheet lands must therefore be
   either bounded or re-measured once it has. See rk.js §12.6.

   Usage
     node scripts/coldload-footer.mjs [options]

       --delay=N        ms to hold the stylesheet back      (default 1500)
       --port=N         static server port                  (default 8897)
       --tolerance=N    px allowed between footer and end   (default 8)
       --root=DIR       site to serve                       (default dist)
       --url=ORIGIN     test a live origin instead of serving
       --browser=NAME   chromium | firefox | webkit        (default chromium)
   ========================================================================== */

import { chromium, firefox, webkit } from 'playwright';
import { serve } from './serve-static.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DELAY = Number(arg('delay', 1500));
const PORT = Number(arg('port', 8897));
const TOLERANCE = Number(arg('tolerance', 8));
const SITE = path.resolve(ROOT, arg('root', 'dist'));
const ORIGIN = arg('url', null);
const ENGINE = arg('browser', 'chromium');
const LAUNCHERS = { chromium, firefox, webkit };
if (!LAUNCHERS[ENGINE]) {
  console.error(`unknown --browser=${ENGINE} (chromium | firefox | webkit)`);
  process.exit(2);
}

/* Both homepages, and the three frames the art direction is locked at. */
const PAGES = [
  { name: 'HU', path: '/' },
  { name: 'EN', path: '/en/' }
];
const VIEWPORTS = [
  { name: 'desktop  1440x900', width: 1440, height: 900 },
  { name: 'mobile    390x844', width: 390, height: 844 },
  { name: 'landscape 844x390', width: 844, height: 390 }
];

/* The measurement. Run in the page, after it has settled. */
function measure() {
  const footer =
    document.querySelector('footer') || document.querySelector('[role="contentinfo"]');
  if (!footer) return { error: 'no footer' };

  const footerBottom = Math.round(footer.getBoundingClientRect().bottom + window.scrollY);
  const scrollHeight = document.documentElement.scrollHeight;

  /* When it fails, name the box that did it rather than reporting a number
     nobody can act on. */
  let owner = null;
  if (scrollHeight - footerBottom > 8) {
    let worst = null;
    for (const el of document.querySelectorAll('body *')) {
      const bottom = Math.round(el.getBoundingClientRect().bottom + window.scrollY);
      if (bottom > footerBottom + 8 && (!worst || bottom > worst.bottom)) {
        worst = {
          bottom,
          selector:
            el.tagName.toLowerCase() +
            (el.id ? `#${el.id}` : '') +
            (typeof el.className === 'string' && el.className.trim()
              ? '.' + el.className.trim().split(/\s+/).join('.')
              : ''),
          height: Math.round(el.getBoundingClientRect().height),
          position: getComputedStyle(el).position
        };
      }
    }
    owner = worst;
  }

  return { scrollHeight, footerBottom, phantom: scrollHeight - footerBottom, owner };
}

const server = ORIGIN ? null : await serve(SITE, PORT);
const base = ORIGIN || `http://127.0.0.1:${PORT}`;
const browser = await LAUNCHERS[ENGINE].launch();

let failures = 0;
console.log(
  `\ncold-load footer check — ${base}  [${ENGINE}]  ` +
    `(stylesheet held back ${DELAY}ms, tolerance ${TOLERANCE}px)\n`
);

for (const pageDef of PAGES) {
  for (const vp of VIEWPORTS) {
    /* A NEW CONTEXT EVERY TIME. Fresh cache, fresh storage, no prior visit to
       this origin — the cold load is the whole point, and a context reused
       from the previous case is a warm one. */
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }
    });
    const page = await ctx.newPage();

    await page.route(/\.css(\?|$)/i, async (route) => {
      await new Promise((r) => setTimeout(r, DELAY));
      await route.continue();
    });

    await page.goto(base.replace(/\/$/, '') + pageDef.path, { waitUntil: 'load' });

    /* Settled means: the stylesheet has landed and everything it moved has
       been re-measured. Wait past the delay, then give the readers a couple
       of frames to answer it. */
    await page.waitForTimeout(DELAY + 1200);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    );

    const m = await page.evaluate(measure);
    const ok = !m.error && Math.abs(m.phantom) <= TOLERANCE;
    if (!ok) failures++;

    const label = `${pageDef.name} ${vp.name}`;
    if (m.error) {
      console.log(`  FAIL  ${label}  ${m.error}`);
    } else {
      console.log(
        `  ${ok ? 'PASS' : 'FAIL'}  ${label}  ` +
          `scrollHeight=${m.scrollHeight}  footerBottom=${m.footerBottom}  phantom=${m.phantom}`
      );
      if (m.owner) {
        console.log(
          `          hangs below the footer: ${m.owner.selector} ` +
            `(${m.owner.position}, ${m.owner.height}px tall, bottom ${m.owner.bottom})`
        );
      }
    }

    await ctx.close();
  }
}

await browser.close();
if (server) server.close();

console.log(
  failures === 0
    ? '\nRESULT : PASS — the footer is the end of the document.\n'
    : `\nRESULT : FAIL — ${failures} case(s) with document below the footer.\n`
);
process.exit(failures === 0 ? 0 : 1);
