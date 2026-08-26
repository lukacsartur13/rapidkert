/* ==========================================================================
   RAPIDKERT — PRODUCTION BUILD                                  [PHASE 3.2C]
   --------------------------------------------------------------------------
   The files at the repository root are the SOURCES and stay readable:
   rk.css, rk.js, rk-ground.js and the .html documents are edited by hand and
   are the only authority. Nothing in dist/ is ever edited — it is deleted and
   rewritten by this script.

       npm ci && npm run build      ->  dist/

   What it does, and why each step exists:

     JS      rk-ground.js is bundled against the npm `three` package instead
             of the pre-minified vendor file, so the ~35 classes the scene
             actually uses are the only ones that ship. Lighthouse measured
             ~90 KiB of the 168 KiB vendor bundle as unused.
     CSS     rk.css is minified whole, and a small critical subset is inlined
             in <head> so the first paint no longer waits on a 73 KiB
             render-blocking request. The full sheet still loads — the inline
             copy is a strict subset, in source order, so the cascade is
             unchanged when it arrives.
     IMAGES  AVIF + WebP beside every JPEG the pages actually reference, and
             the two 404x118 logo PNGs re-rendered at the sizes they are
             displayed at.
     HASHES  Every generated asset carries a content hash, so a host can
             serve them `immutable` for a year. GitHub Pages currently caps
             everything at 600s and offers no way to change that; the hashes
             cost nothing today and are the precondition for fixing it.

   Deterministic: same inputs, same output names. No global tools.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { transform as lcssTransform } from 'lightningcss';
import sharp from 'sharp';
import { criticalCss } from './build/critical-css.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const log = (...a) => console.log('  ' + a.join(' '));
const kb = (n) => (n / 1024).toFixed(1) + 'K';

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);

/* Encoding forty AVIFs at effort 9 takes minutes and the inputs almost never
   change. Results are cached under .cache/ (gitignored) keyed by the source
   bytes AND the encoder settings, so a settings change still re-encodes. */
const CACHE = path.join(ROOT, '.cache', 'img');
fs.mkdirSync(CACHE, { recursive: true });
async function encoded(srcBuf, key, produce) {
  const f = path.join(CACHE, `${hash(srcBuf)}.${key}`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const buf = await produce();
  fs.writeFileSync(f, buf);
  return buf;
}

/* -- 0. clean ------------------------------------------------------------ */
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.mkdirSync(path.join(DIST, 'en'), { recursive: true });

const HTML = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))
  .map(f => ({ src: path.join(ROOT, f), rel: f, depth: 0 }))
  .concat(fs.readdirSync(path.join(ROOT, 'en')).filter(f => f.endsWith('.html'))
    .map(f => ({ src: path.join(ROOT, 'en', f), rel: 'en/' + f, depth: 1 })));

/* Which images the documents actually ask for. Everything else in the tree is
   a master the site never links to, and shipping optimised copies of files
   nobody requests is just a slower build. */
const htmlText = new Map(HTML.map(h => [h.rel, fs.readFileSync(h.src, 'utf8')]));
const referenced = new Set();
for (const t of htmlText.values()) {
  for (const m of t.matchAll(/(?:src|href|content)="(?:\.\.\/)?([A-Za-z0-9._-]+\.(?:jpg|jpeg|png|svg))"/g)) {
    referenced.add(m[1]);
  }
  for (const m of t.matchAll(/(?:srcset)="([^"]+)"/g)) {
    for (const part of m[1].split(',')) {
      const u = part.trim().split(/\s+/)[0].replace(/^\.\.\//, '');
      if (/\.(jpg|jpeg|png)$/.test(u)) referenced.add(u);
    }
  }
}

/* ==========================================================================
   1 — JAVASCRIPT
   ========================================================================== */
console.log('\nJS');

/* rk-ground imports three by the vendor path. Point that one specifier at the
   npm package so esbuild can see the module graph and drop what is unused. */
const threeAlias = {
  name: 'three-alias',
  setup(b) {
    b.onResolve({ filter: /vendor\/three\.module\.min\.js$/ }, () => ({
      path: path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js'),
    }));
  },
};

/* ONE FILE, AND THE CAPABILITY GATE DOES NOT CHANGE THAT.        [PHASE 3.2D]
   Splitting three into its own chunk, so a page routed to the stacked
   fallback could skip it, was built and reverted. Two reasons, both measured:

     · It buys nothing. The gate lives in the document head and mounts the
       module only on the hardware path, so the fallback already requests
       neither this bundle nor any chunk of it.
     · It costs the path that DOES draw. Splitting requires a dynamic import,
       and a dynamic `import * as` hides from esbuild which of three's exports
       the scene reads: 663.8K as a chunk and 734.0K inlined, against 570.3K
       whole-bundle with the ~90 KiB of unused three shaken out. */
const groundOut = await esbuild.build({
  entryPoints: [path.join(ROOT, 'rk-ground.js')],
  bundle: true, format: 'esm', target: 'es2020',
  minify: process.env.RK_NOMIN ? false : true, treeShaking: true, legalComments: 'none',
  plugins: [threeAlias], write: false, metafile: true,
});
const groundCode = groundOut.outputFiles[0].contents;
const groundName = `rk-ground.${hash(groundCode)}.js`;
fs.writeFileSync(path.join(DIST, groundName), groundCode);

const rkOut = await esbuild.build({
  entryPoints: [path.join(ROOT, 'rk.js')],
  bundle: false, format: 'iife', target: 'es2020',
  minify: process.env.RK_NOMIN ? false : true, legalComments: 'none', write: false,
});
const rkCode = rkOut.outputFiles[0].contents;
const rkName = `rk.${hash(rkCode)}.js`;
fs.writeFileSync(path.join(DIST, rkName), rkCode);

const srcGround = fs.statSync(path.join(ROOT, 'rk-ground.js')).size;
const srcThree = fs.statSync(path.join(ROOT, 'vendor/three.module.min.js')).size;
const srcRk = fs.statSync(path.join(ROOT, 'rk.js')).size;
log(`rk-ground.js + three : ${kb(srcGround + srcThree)} -> ${kb(groundCode.length)}  ${groundName}`);
log(`rk.js                : ${kb(srcRk)} -> ${kb(rkCode.length)}  ${rkName}`);

/* ==========================================================================
   2 — CSS
   ========================================================================== */
console.log('\nCSS');
const cssSrc = fs.readFileSync(path.join(ROOT, 'rk.css'));
const cssMin = lcssTransform({
  filename: 'rk.css', code: cssSrc, minify: true,
  targets: { safari: 15 << 16, chrome: 100 << 16, firefox: 100 << 16 },
}).code;
const cssName = `rk.${hash(cssMin)}.css`;
fs.writeFileSync(path.join(DIST, cssName), cssMin);

const criticalRaw = criticalCss(cssSrc.toString('utf8'));
const critical = lcssTransform({
  filename: 'critical.css', code: Buffer.from(criticalRaw), minify: true,
  targets: { safari: 15 << 16, chrome: 100 << 16, firefox: 100 << 16 },
}).code.toString('utf8');
log(`rk.css               : ${kb(cssSrc.length)} -> ${kb(cssMin.length)}  ${cssName}`);
log(`critical (inline)    : ${kb(critical.length)}`);

/* ==========================================================================
   3 — IMAGES
   ========================================================================== */
console.log('\nIMAGES');
const imageMap = new Map();     // source filename -> { avif, webp, jpg?, w, h }

/* The nav logos are 404x118 PNGs displayed at 144x42 and transferring ~40 KiB
   each. Re-rendered at 288w — 2x the displayed width, the most any phone will
   ask for — and quantised to 16 colours, which is 4.4 KiB. Compared against
   the untouched original at 4x magnification: at 8 colours the mark's
   diagonal edges roughen visibly, at 16 nothing separates it from the source.

   No WebP: a 16-colour PNG of a two-tone logotype is 4.4 KiB and the WebP of
   the same thing is 10.9 KiB. The negotiation would cost more than it saves,
   and this is the LCP element — one unconditional request is the point. */
const LOGO_W = 288;
for (const logo of ['logo.png', 'logo-feher.png']) {
  if (!fs.existsSync(path.join(ROOT, logo))) continue;
  const base = logo.replace(/\.png$/, '');
  const logoSrc = fs.readFileSync(path.join(ROOT, logo));
  const meta = await sharp(logoSrc).metadata();
  const h = Math.round(meta.height * (LOGO_W / meta.width));
  const png = await encoded(logoSrc, `png${LOGO_W}c16`, () => sharp(logoSrc).resize(LOGO_W, h)
    .png({ compressionLevel: 9, palette: true, colours: 16, effort: 10 }).toBuffer());
  const pngName = `${base}.${hash(png)}.png`;
  fs.writeFileSync(path.join(DIST, pngName), png);
  imageMap.set(logo, { png: pngName, w: LOGO_W, h });
  log(`${logo.padEnd(20)} : ${kb(fs.statSync(path.join(ROOT, logo)).size)} -> png ${kb(png.length)}`);
}

/* Photographs. The thumbs are what the pages load first, and one of them —
   kesz-gyep-terasz-thumb.jpg at 243 KiB — is the single heaviest request on
   the homepage. AVIF first, WebP second, the original JPEG last so nothing
   without modern format support loses the picture.

   Quality is deliberately conservative: these are grass, paving and fine
   foliage, the texture class that falls apart first under a codec. q44 was
   chosen by putting a 500x330 crop of the mowing stripes and the paving edge
   from kesz-gyep-terasz-thumb.jpg side by side with the source at 1:1. q38
   also held; q44 leaves margin on the harder plates.

   WebP is not emitted. On this library it is consistently LARGER than the
   source JPEG at every quality that keeps the texture (206 KiB at q50 against
   a 243 KiB source that already looks better), so a WebP <source> would be a
   negotiation that makes the page slower. AVIF or the original, nothing in
   between. Any variant that fails to beat its source is dropped. */
const photos = [...referenced].filter(f => /\.jpe?g$/.test(f)).sort();
for (const f of photos) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) continue;
  const base = f.replace(/\.jpe?g$/, '');
  const orig = fs.readFileSync(abs);
  const meta = await sharp(abs).metadata();
  const avif = await encoded(orig, 'avif44e9', () =>
    sharp(orig).avif({ quality: 44, effort: 9, chromaSubsampling: '4:2:0' }).toBuffer());
  const jpgName = `${base}.${hash(orig)}.jpg`;
  fs.writeFileSync(path.join(DIST, jpgName), orig);
  const rec = { jpg: jpgName, w: meta.width, h: meta.height };
  if (avif.length < orig.length * 0.94) {
    const avifName = `${base}.${hash(avif)}.avif`;
    fs.writeFileSync(path.join(DIST, avifName), avif);
    rec.avif = avifName;
  }
  imageMap.set(f, rec);
  log(`${f.padEnd(38)} : ${kb(orig.length)} -> avif ${kb(avif.length)}${rec.avif ? '' : '  (dropped, no gain)'}`);
}

/* SVG and anything else the documents reference, copied with a hash. */
for (const f of referenced) {
  if (imageMap.has(f)) continue;
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) continue;
  const buf = fs.readFileSync(abs);
  const ext = path.extname(f);
  const name = `${f.slice(0, -ext.length)}.${hash(buf)}${ext}`;
  fs.writeFileSync(path.join(DIST, name), buf);
  imageMap.set(f, { plain: name });
}

/* Unhashed passthroughs: crawler-facing files whose URLs are public contracts. */
for (const f of ['robots.txt', 'sitemap.xml', 'assets.json', 'llms.txt']) {
  if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
}

/* ==========================================================================
   4 — HTML
   ========================================================================== */
console.log('\nHTML');

/* Convert the render-blocking stylesheet link into: an inlined critical
   subset, a non-blocking request for the whole sheet, and a <noscript> copy
   for the case where the swap can never run. */
function styleBlock(prefix) {
  return `<style>${critical}</style>\n`
    + `<link rel="preload" href="${prefix}${cssName}" as="style" onload="this.onload=null;this.rel='stylesheet'">\n`
    + `<noscript><link rel="stylesheet" href="${prefix}${cssName}"></noscript>`;
}

let htmlBefore = 0, htmlAfter = 0;
for (const doc of HTML) {
  let t = htmlText.get(doc.rel);
  htmlBefore += Buffer.byteLength(t);
  const prefix = doc.depth ? '../' : '';
  const P = (s) => prefix + s;

  /* stylesheet */
  t = t.replace(new RegExp(`<link rel="stylesheet" href="${prefix ? '\\.\\./' : ''}rk\\.css">`), styleBlock(prefix));

  /* Scripts. The two module URLs live as string literals inside the
     capability gate in <head>, which injects them as modulepreloads only on
     the hardware path — so this is where the hashed, code-split names are
     substituted. Nothing else in the document names either file. */
  t = t.replace(new RegExp(`var GROUND = '${prefix ? '\\.\\./' : ''}rk-ground\\.js';`), `var GROUND = '${P(groundName)}';`);
  /* three is inlined into that bundle, so there is no second file to warm.
     The gate skips the preload when this is empty. */
  t = t.replace(new RegExp(`var THREE_URL = '${prefix ? '\\.\\./' : ''}vendor/three\\.module\\.min\\.js';`), `var THREE_URL = '';`);
  t = t.replace(new RegExp(`<script src="${prefix ? '\\.\\./' : ''}rk\\.js" defer></script>`), `<script src="${P(rkName)}" defer></script>`);

  /* images: <img> elements become <picture> with AVIF and WebP in front. */
  t = rewriteImages(t, prefix);

  /* remaining flat references (favicon, og:image, preloads, CSS-free links) */
  for (const [src, out] of imageMap) {
    const to = out.plain || out.png || out.jpg;
    t = t.split(`"${prefix}${src}"`).join(`"${P(to)}"`);
    t = t.split(`https://rapidkert.com/${src}`).join(`https://rapidkert.com/${to}`);
  }

  t = minifyHtml(t);

  /* A missed substitution is a 404 on a file the homepage's whole experience
     depends on, and it would read as "the scene stopped working" rather than
     as a build fault — the capability gate holds two of these URLs as string
     literals now, where a regex can go stale without anything else noticing.

     Quoted occurrences only: these documents also DISCUSS their own assets by
     name, in prose that is deliberately kept, and a bare substring match
     would fire on the sentence rather than on the reference. */
  for (const stale of ['rk-ground.js', 'vendor/three.module.min.js', 'rk.js', 'rk.css']) {
    if (new RegExp(`["'](?:\\.\\./)?${stale.replace(/\./g, '\\.')}["']`).test(t)) {
      throw new Error(`${doc.rel}: unrewritten reference to ${stale}`);
    }
  }

  htmlAfter += Buffer.byteLength(t);
  fs.writeFileSync(path.join(DIST, doc.rel), t);
}
log(`${HTML.length} documents : ${kb(htmlBefore)} -> ${kb(htmlAfter)}`);

/* The documents carry a great deal of prose about themselves — why a plate is
   eager, what the datum is measuring, which phase changed a rule and what it
   broke. That is the point of them and none of it is removed from the source.
   It is 40% of index.html's bytes, though, and those bytes are on the
   critical path: the document has to arrive and be parsed before anything
   can paint. So production ships the markup without the margin notes.

   Deliberately conservative. Comments go; leading indentation goes, because
   an indent that follows a newline collapses to the same single space the
   newline already provides. Nothing else is touched — no tag omission, no
   attribute quoting games, and script and style bodies are left exactly as
   they are, so nothing here can change what the page renders. */
function minifyHtml(t) {
  const keep = [];
  /* Script and style bodies are parked first so nothing below can reach
     into them. The sentinel is NUL, which is not legal in an HTML document
     — a bare numeric placeholder would have collided with any number
     surrounded by spaces in the copy. */
  t = t.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => `\0${keep.push(m) - 1}\0`);
  t = t.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
  t = t.replace(/\n[ \t]+/g, '\n');
  t = t.replace(/\n{2,}/g, '\n');
  return t.replace(/\0(\d+)\0/g, (m, i) => keep[+i]);
}

/* Wrap every <img> whose source has modern variants in a <picture>. Any
   attribute the author wrote — sizes, srcset, fetchpriority, loading, width,
   height, class, alt — is left exactly where it is on the <img>; the AVIF and
   WebP <source>s are added in front of it and inherit the same `sizes`. */
function rewriteImages(t, prefix) {
  return t.replace(/<img\b[^>]*>/g, (tag) => {
    /* data-defer: the element carries its URLs in data- attributes and a
       script attaches them when the page is ready for the picture. The build
       still has to rewrite those URLs to the hashed, AVIF-converted ones, so
       the attribute names are swapped out and back around the normal path. */
    const deferred = / data-defer\b/.test(tag);
    if (deferred) tag = tag.replace(/ data-src(set)?=/g, ' src$1=');

    const srcM = tag.match(/\ssrc="(?:\.\.\/)?([A-Za-z0-9._-]+\.(?:jpg|jpeg|png))"/);
    if (!srcM) return tag;
    const out = imageMap.get(srcM[1]);
    if (!out || (!out.avif && !out.webp)) return tag;

    const sizesM = tag.match(/\ssizes="([^"]*)"/);
    const srcsetM = tag.match(/\ssrcset="([^"]*)"/);
    const sizesAttr = sizesM ? ` sizes="${sizesM[1]}"` : '';

    /* A srcset of source-tree filenames has to become one of built ones. */
    const mapSrcset = (raw, kind) => raw.split(',').map(part => {
      const [u, ...rest] = part.trim().split(/\s+/);
      const key = u.replace(/^\.\.\//, '');
      const built = imageMap.get(key);
      const file = built ? (built[kind] || built.jpg || built.png) : key;
      return [prefix + file, ...rest].join(' ');
    }).join(', ');

    const sources = [];
    for (const kind of ['avif', 'webp']) {
      if (!out[kind]) continue;
      const set = srcsetM ? mapSrcset(srcsetM[1], kind) : prefix + out[kind];
      sources.push(`<source type="image/${kind}" srcset="${set}"${sizesAttr}>`);
    }
    let img = tag;
    if (srcsetM) img = img.replace(/\ssrcset="[^"]*"/, ` srcset="${mapSrcset(srcsetM[1], 'jpg')}"`);
    img = img.replace(/\ssrc="(?:\.\.\/)?([A-Za-z0-9._-]+\.(?:jpg|jpeg|png))"/,
      (m, f) => ` src="${prefix}${(imageMap.get(f) || {}).jpg || (imageMap.get(f) || {}).png || f}"`);
    let picture = `<picture>${sources.join('')}${img}</picture>`;
    if (deferred) picture = picture.replace(/ src(set)?=/g, ' data-src$1=');
    return picture;
  });
}

console.log(`\ndist/ written — ${fs.readdirSync(DIST).length} entries at the root\n`);
