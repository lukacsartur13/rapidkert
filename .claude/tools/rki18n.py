#!/usr/bin/env python3
"""Structural guard for the HU/EN localisation. Offline, stdlib only.

WHAT THIS IS FOR. Phase 3.3 put a second language tree next to the first one
and gave them one stylesheet, one interaction layer and one WebGL module. The
failure mode that creates is not a crash — it is a page that quietly stops
having a counterpart, or an English document that still says lang="hu", or a
canonical that points at the other language. None of that throws, none of it
shows up in a screenshot, and all of it is invisible until a search engine or
a juror finds it.

So this asserts the things that must be true of the pair, and nothing about
how it looks:

  1. every route in the map exists, both sides
  2. <html lang> matches the tree the file is in
  3. the canonical is self-referential
  4. hu / en / x-default are present and RECIPROCAL
  5. every EN page carries the language switch, and it points at that page's
     own Hungarian counterpart — not at the homepage
  6. the shared assets resolve from /en/ (../rk.css, ../rk.js, ../rk-ground.js)
  7. no EN page ships its own copy of a shared asset
  8. every JSON-LD block parses, and no EN block carries a HU URL

usage:  python3 rki18n.py [root]
exit 0 = PASS, 1 = FAIL
"""
import json, os, re, sys

BASE = 'https://rapidkert.com/'

# HU route, EN route, and the canonical URL each one must declare.
ROUTES = [
    ('index.html',                'en/index.html',                 BASE,                    BASE + 'en/'),
    ('kertepites-gyor.html',      'en/garden-construction.html',   None, None),
    ('ontozorendszer-gyor.html',  'en/irrigation-systems.html',    None, None),
    ('felszin-alatti-ontozes.html','en/subsurface-irrigation.html', None, None),
    ('referenciak.html',          'en/projects.html',              None, None),
    ('rolunk.html',               'en/about.html',                 None, None),
    ('kapcsolat.html',            'en/contact.html',               None, None),
]

# The two homepages are reached by DIRECTORY, never by filename. GitHub Pages
# answers /index.html and /en/index.html with 200 rather than a redirect, so a
# link to the filename hands a crawler a second URL for a page that already has
# a canonical one — the duplicate-content half of the Semrush sitemap finding.
# Every other route is a real filename and links as itself.
LINK_FORM = {'index.html': './', 'en/index.html': 'en/'}

# Hungarian-only by decision, not by omission: these are the filings of a
# Hungarian company and no English version of them has been approved.
HU_ONLY = ['impresszum.html', 'adatkezelesi-tajekoztato.html', 'cookie-tajekoztato.html']

SHARED = ['rk.css', 'rk.js', 'rk-ground.js', 'vendor/three.module.min.js']


def read(root, p):
    with open(os.path.join(root, p), encoding='utf-8') as f:
        return f.read()


def check(root='.'):
    fails = []

    def need(path, why):
        if not os.path.exists(os.path.join(root, path)):
            fails.append(f'missing {why}: {path}')
            return False
        return True

    # 6/7 — the shared layer is shared.
    for a in SHARED:
        need(a, 'shared asset')
    for stray in SHARED:
        p = os.path.join('en', os.path.basename(stray))
        if os.path.exists(os.path.join(root, p)):
            fails.append(f'DUPLICATED SHARED ASSET: {p} — both languages must load the root copy')

    for hu, en, hu_can, en_can in ROUTES:
        hu_can = hu_can or BASE + hu
        en_can = en_can or BASE + en
        if not (need(hu, 'HU route') and need(en, 'EN route')):
            continue

        for path, lang, can, other in ((hu, 'hu', hu_can, en_can), (en, 'en', en_can, hu_can)):
            s = read(root, path)

            m = re.search(r'<html lang="([^"]+)"', s)
            if not m or m.group(1) != lang:
                fails.append(f'{path}: <html lang> is {m.group(1) if m else "absent"}, expected {lang}')

            m = re.search(r'<link rel="canonical" href="([^"]+)"', s)
            if not m:
                fails.append(f'{path}: no canonical')
            elif m.group(1) != can:
                fails.append(f'{path}: canonical {m.group(1)} != {can}')

            alts = dict(re.findall(r'<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"', s))
            for k in ('hu', 'en', 'x-default'):
                if k not in alts:
                    fails.append(f'{path}: hreflang {k} missing')
            if alts.get(lang) != can:
                fails.append(f'{path}: hreflang {lang} -> {alts.get(lang)}, expected self ({can})')
            if alts.get('en' if lang == 'hu' else 'hu') != other:
                fails.append(f'{path}: hreflang counterpart -> '
                             f'{alts.get("en" if lang == "hu" else "hu")}, expected {other}')
            if alts.get('x-default') != hu_can:
                fails.append(f'{path}: x-default -> {alts.get("x-default")}, expected the '
                             f'Hungarian document ({hu_can})')

            # 5 — the switch exists and preserves the page, in the bar.
            if 'rk-lang__i' not in s:
                fails.append(f'{path}: no language switch')
            else:
                if lang == 'en':
                    want = '../' if hu == 'index.html' else '../' + hu
                else:
                    want = LINK_FORM.get(en, en)
                if f'href="{want}"' not in s:
                    fails.append(f'{path}: language switch does not link to its counterpart '
                                 f'(expected href="{want}")')

            # 8 — schema parses, and does not cross languages.
            for i, b in enumerate(re.findall(
                    r'<script type="application/ld\+json">(.*?)</script>', s, re.S)):
                try:
                    d = json.loads(b)
                except Exception as e:
                    fails.append(f'{path} ld+json#{i}: does not parse — {e}')
                    continue
                txt = json.dumps(d, ensure_ascii=False)
                urls = re.findall(r'"(' + re.escape(BASE) + r'[^"]*)"', txt)
                if lang == 'en':
                    stray = sorted({u for u in urls if '/en/' not in u})
                    if stray:
                        fails.append(f'{path} ld+json#{i}: Hungarian URL in an English block: {stray}')
                else:
                    stray = sorted({u for u in urls if '/en/' in u})
                    if stray:
                        fails.append(f'{path} ld+json#{i}: English URL in a Hungarian block: {stray}')

        # 6 — the English document loads the shared layer from the root.
        s = read(root, en)
        for a in ('../rk.css', '../rk.js'):
            if a not in s:
                fails.append(f'{en}: does not load {a}')
        if en == 'en/index.html' and '../rk-ground.js' not in s:
            fails.append('en/index.html: does not load ../rk-ground.js')

    # 9 — nobody reintroduces the duplicate homepage URL. A link to
    # index.html, en/index.html or ../index.html resolves to the same document
    # as ./, en/ and ../ do, but it is a DIFFERENT URL to a crawler, and it is
    # not the one the canonical names.
    for p in [r for pair in ROUTES for r in pair[:2]] + HU_ONLY:
        if not os.path.exists(os.path.join(root, p)):
            continue
        for bad in re.findall(r'href="((?:\.\./|en/)?index\.html)"', read(root, p)):
            fails.append(f'{p}: links to {bad} — a duplicate URL for a page that '
                         f'already has a canonical one; link the directory instead')

    # 10 — inLanguage belongs to CreativeWork, not to the business or its
    # services. schema.org lists the property on CreativeWork, Event,
    # BroadcastService and a few actions; LocalBusiness is an Organization and
    # a Place, and Service is an Intangible, so neither may carry it. Tagging
    # the English tree by hand is exactly how it got onto all four in the
    # first place, and only the LocalBusiness one was loud enough for an
    # external validator to catch.
    CREATIVEWORK = {'CreativeWork', 'WebPage', 'AboutPage', 'ContactPage',
                    'CollectionPage', 'WebSite', 'FAQPage', 'ItemPage',
                    'Article', 'Event', 'BroadcastService'}

    def scan(node, path, where):
        if isinstance(node, list):
            for i, x in enumerate(node):
                scan(x, f'{path}[{i}]', where)
            return
        if not isinstance(node, dict):
            return
        if 'inLanguage' in node:
            t = str(node.get('@type'))
            if t not in CREATIVEWORK:
                fails.append(f'{where}: inLanguage on {t} at {path or "(root)"} — '
                             f'schema.org allows it on CreativeWork and Event, '
                             f'not on a business or a service')
        for k, v in node.items():
            scan(v, f'{path}.{k}', where)

    for p in [r for pair in ROUTES for r in pair[:2]] + HU_ONLY:
        if not os.path.exists(os.path.join(root, p)):
            continue
        for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>',
                            read(root, p), re.S):
            try:
                scan(json.loads(b), '', p)
            except Exception:
                pass          # check 8 already reports blocks that do not parse

    for p in HU_ONLY:
        need(p, 'Hungarian-only legal document')

    print(f'  routes  : {len(ROUTES)} pairs, {len(HU_ONLY)} HU-only')
    for f in fails:
        print(f'  FAIL    : {f}')
    print('  RESULT  :', 'PASS' if not fails else 'FAIL')
    return fails


if __name__ == '__main__':
    sys.exit(1 if check(sys.argv[1] if len(sys.argv) > 1 else '.') else 0)
