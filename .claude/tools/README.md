# rk.css safety tools  (dev-only; nothing here is served)

`rk.css` was destroyed once by a first-match splice:

    a = text.index('@media (max-width:1024px){')   # matched §31.8, not §32.9
    s = s[:a] + new + s[b:]                        # deleted ~1,470 lines

Both files below exist to make that impossible to repeat.

## rkedit.py — the only sanctioned way to mutate rk.css
`replace_unique`, `replace_between_unique`, `replace_to_eof_after_unique`,
`insert_before_unique`. Every one asserts uniqueness and writes NOTHING when
an assertion fails. Never use `.index()` on generic CSS syntax.

## rkguard.py — run BEFORE and AFTER every mutation
    python3 .claude/tools/rkguard.py rk.css     # exit 0 = PASS

Checks line/byte floors, all 25 required numbered section headings, the
critical selectors, the handover contracts (`.fld` -100svh overlap,
`.gd.is-handed`, the shared `--datum`), and brace balance. Balanced braces
alone are NOT enough — the destroyed file still parsed cleanly.
