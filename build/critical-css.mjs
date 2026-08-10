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

/* Everything the first viewport of any page needs: the document shell, the
   custom-property root, the nav, the skip link, the page-entry wipe, and the
   whole Living Ground hero — stage, canvas, headline, datum, chapter one. */
const KEEP = [
  /* document shell and the custom-property root everything else reads */
  /^:root\b/, /^html\b/, /^body\b/, /^\*/, /^::?selection\b/, /^\[hidden\]/,
  /^(img|svg|video|a|button|h1)\b/,
  /* the header, the skip link, the page-entry wipe */
  /^\.skip\b/, /^\.shell\b/, /^\.rk-wipe/, /^\.rk-nav/, /^\.rk-lang/,
  /* The whole Living Ground. Trimming this to "just the hero" was a false
     economy that cost 0.004 CLS: the hero's H1 sets `.display`, and with
     `.display` deferred the three headline lines measured 35px instead of
     30px, so the copy block under them dropped 15px the instant the async
     sheet landed. The section is one sticky 100svh stage whose eleven
     chapters all share the first viewport's box — there is no part of it
     that is genuinely below the fold. */
  /^\.gd\b/, /^\.gd-on\b/, /^\.gd-ready\b/, /^\.no-js\b/, /^\.gd__/,
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
