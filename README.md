# Rapidkert Kft. — website

Static site. No build step, no dependencies to install: `index.html` loads
`rk.css`, `rk.js` and `rk-ground.js` directly, plus `vendor/three.module.min.js`
for the Living Ground model.

## Layout

| Path | What it is |
|---|---|
| `index.html` | Homepage — the whole Living Ground narrative |
| `rk.css` | The single stylesheet, ~3,860 lines in numbered sections §01–§33 |
| `rk.js` | Scroll reader, stage controllers, the §14 world geometry |
| `rk-ground.js` | WebGL Living Ground (model, camera, photo handover) |
| `*.html` | Inner pages (services, references, legal) |
| `vendor/` | three.js |
| `_retired/` | Pre-Phase-1 stylesheet and script, kept for reference |
| `.claude/tools/` | rk.css safety tools — see below |

## Preview

```bash
sh .claude/tools/serve.sh
```

Then open <http://localhost:8811/index.html>. (The mirror-to-`/private/tmp`
dance is because iCloud Drive blocks `os.getcwd()` for the server process.)

Set `PORT` to run a second preview alongside the first — the mirror is
per-port, so two servers never rsync over each other:

```bash
PORT=8814 sh .claude/tools/serve.sh
```

The mirror is a **copy**. Re-run the script (or just the `rsync` line inside
it) after editing, or the browser will keep serving the last snapshot.

### Freezing a state

Every stage takes a scroll position from the URL, which is the only exact way
to inspect one: `?stage=fld:.92`, `?stage=lyr:.5,asm:.8`, or from the console
`RK_STAGE.set('prf', .9)` / `RK_STAGE.free()`. `RK_STAGE.set` runs the readers
**synchronously**, which also makes it the only way to drive them in a tab
that is not producing animation frames.

## Editing rk.css — read this first

`rk.css` has repeated boundary strings by design: `@media (max-width:1024px){`
opens §19, §31.8 **and** §32.9. On 2026-08-08 a scripted splice anchored on
that string with `text.index(...)` matched the wrong one and silently deleted
~1,470 lines — §31.8 through §33. The CSS still parsed and the braces still
balanced; the only symptom was that everything below the hero rendered
unstyled. It was rebuilt by replaying the edit history.

So:

1. **Never** anchor a scripted edit on a selector, a media query or a prose
   comment. Anchor on the numbered section heading (`32.9 — RESPONSIVE`).
2. Use `.claude/tools/rkedit.py` — `replace_unique`,
   `replace_between_unique`, `replace_to_eof_after_unique`,
   `insert_before_unique`. Each asserts uniqueness and writes **nothing** on
   failure.
3. Run the guard before and after every mutation:

   ```bash
   python3 .claude/tools/rkguard.py rk.css
   ```

   Exit 0 = pass. It checks size floors, all 25 required numbered headings,
   the critical selectors, brace balance, and the handover contracts
   (`.fld` `-100svh` overlap, `.gd.is-handed`, the shared `--datum`).
   Balanced braces alone are not enough — the destroyed file passed that.

The guard also runs automatically as a `pre-commit` hook, so a gutted
`rk.css` cannot be committed. Bypass only deliberately, with
`git commit --no-verify`.

## The three contracts that must not be broken

- **Hero datum** — `.gd__datum` is the authored band inside the `<h1>`; its
  height and `--anchor` are solved against the camera in `rk-ground.js`.
- **Handover** — REALITY → PROJECTS is one continuous photograph. It needs
  all three of: `.fld{margin-top:-100svh}` in `rk.css`, the one-viewport hold
  in `rk.js` §12.1, and `.gd.is-handed` in `rk-ground.js`.
- **One geometry** — the world defined once in `rk.js` §14 is reused by
  services, process and proof. Do not rebuild it three times.
