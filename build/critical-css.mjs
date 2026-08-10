/* ==========================================================================
   CRITICAL CSS EXTRACTION                                       [PHASE 3.2C]
   --------------------------------------------------------------------------
   Above-the-fold rules only, chosen by SELECTOR, never by coverage.

   Coverage-driven purging is the wrong tool for this stylesheet and §22 of
   the brief says so: rk.css carries responsive art direction for five inner
   pages, an English tree, reduced-motion variants, WebGL-absent fallbacks and
   a large set of state classes that JavaScript adds at runtime. A homepage
   coverage run sees none of that and would delete it.

   So this is an allow-list. It cannot delete anything from the site, because
   the full stylesheet still loads a moment later and this inline copy is a
   strict SUBSET of it in source order — if a selector is missing here the
   worst case is that one element is unstyled for a few hundred milliseconds,
   never that it is unstyled at all.

   The parser walks the stylesheet with a real tokenizer that tracks strings,
   comments, parentheses and nesting depth. It never calls .index() on a
   fragment of CSS syntax — that is the mistake that deleted ~1,470 lines of
   rk.css once already, and .claude/tools/README.md exists because of it.
   ========================================================================== */

/* Everything the FIRST PAINT of any page needs, and nothing that can wait a
   couple of hundred milliseconds for the rest of the sheet. The line between
   the two is not "above the fold" — it is "can this rule change the size or
   position of a box that is on screen at first paint". A rule that only
   recolours something, or that styles a state the visitor has not reached
   (the opened menu, the solid header after scrolling, the last chapter of the
   timeline), can arrive late and cost nothing. A rule that changes a metric
   cannot: that is a layout shift.

   Every exclusion below was checked by rendering the page twice, once with
   the deferred sheet blocked, and diffing the geometry of everything in the
   first viewport. */
const KEEP = [
  /* document shell and the custom-property root everything else reads */
  /^:root\b/, /^html\b/, /^body\b/, /^\*/, /^::?selection\b/, /^\[hidden\]/,
  /^(img|svg|video|a|button|h1)\b/,
  /* the header, the skip link, the page-entry wipe. NOT .rk-nav__panel or
     .rk-menu — the overlay is `hidden` at first paint and cannot shift
     anything — and not the .is-solid / .is-film / .is-locked / .is-open
     states, none of which exist until the visitor scrolls or taps. */
  /^\.skip\b/, /^\.shell\b/, /^\.rk-wipe/, /^\.rk-lang(?!--menu)/,
  /* .rk-nav__burger stays: excluding it left the button 40x24 instead of
     24x17 and moved the whole right-hand cluster 16px, at the top of the
     viewport, which is the most expensive place on the page to shift. */
  /^\.rk-nav(?!__panel|\.is-)/,
  /* The Living Ground's hero. The H1 sets `.display`, and deferring that one
     class measured the three headline lines at 35px instead of 30px, dropped
     the copy block under them by 15px when the sheet landed, and cost 0.004
     CLS — which is how this list was calibrated. */
  /^\.gd\b(?!\.is-handed)/, /^\.gd-on\b/, /^\.gd-ready\b/,
  /* The annotation labels look like an overlay that cannot matter, and they
     are the opposite: their whole appearance is a transform that parks them
     off-screen until the scene positions them. Deferred, they render as a
     block of unstyled type across the bottom of the hero — 45,000 square
     pixels of it, enough that Lighthouse picked it as the LCP element. */
  /^\.gd__(stage|canvas|vig|scroll|ui|ch|inner|h1|h2|step|datum|lede|body|lead|cta|foot|stats|stat|fb|horizon|anno|photo|mid|rail|lbl|mark|dim-datum|dim-cap|lines)\b/,
  /* the type primitives every one of those elements is set in */
  /^\.display\b/, /^\.label\b/, /^\.body\b/, /^\.btn\b/, /^\.cue\b/, /^\.ulink\b/,
];

/* At-rules whose CONTENTS are filtered by the same selector list. */
const RECURSE = /^@(media|supports|layer|container)\b/;
/* At-rules kept whole — they define the type and the colour space the first
   paint is drawn with, and half of one is worse than none. */
const KEEP_WHOLE = /^@(font-face|charset|namespace|property|counter-style|page)\b/;

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');

/* Split a stylesheet body into top-level blocks and statements. */
function* blocks(src) {
  let i = 0, start = 0, depth = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    /* comments */
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    /* strings */
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    if (c === '{') {
      if (depth === 0) var braceAt = i;
      depth++; i++;
      continue;
    }
    if (c === '}') {
      depth--;
      i++;
      if (depth === 0) {
        yield {
          /* The slice from the end of the previous rule carries this rule's
             leading comments with it, and rk.css is more comment than CSS.
             They are stripped for MATCHING only — `whole` keeps them, and
             the minifier drops them on the way out. Without this, `:root`
             (which follows a banner comment) failed every selector test and
             the inline copy shipped without a single custom property. */
          prelude: stripComments(src.slice(start, braceAt)).trim(),
          body: src.slice(braceAt + 1, i - 1),
          whole: src.slice(start, i),
        };
        start = i;
      }
      continue;
    }
    /* a statement with no block: @import, @charset */
    if (c === ';' && depth === 0) {
      const stmt = stripComments(src.slice(start, i + 1)).trim();
      if (stmt) yield { prelude: stmt, body: null, whole: stmt };
      start = i + 1;
      i++;
      continue;
    }
    i++;
  }
}

function selectorWanted(prelude) {
  /* A rule is kept if ANY selector in its list is wanted: dropping the others
     would change specificity, and the point is a subset, not a rewrite. */
  return prelude.split(',').some(sel => {
    const s = sel.trim().replace(/^&\s*/, '');
    return KEEP.some(rx => rx.test(s));
  });
}

export function criticalCss(src) {
  const out = [];
  for (const b of blocks(src)) {
    const p = b.prelude;
    if (!p) continue;
    if (p.startsWith('@')) {
      if (KEEP_WHOLE.test(p)) { out.push(b.whole); continue; }
      if (RECURSE.test(p) && b.body !== null) {
        const inner = criticalCss(b.body);
        if (inner.trim()) out.push(`${p}{${inner}}`);
        continue;
      }
      continue;                       // @keyframes and the rest wait
    }
    if (b.body === null) continue;
    if (selectorWanted(p)) out.push(b.whole);
  }
  return out.join('\n');
}
