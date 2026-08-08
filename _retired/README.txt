RETIRED — Phase 1.5

style.css and script.js were the legacy stylesheet and script. As of Phase 1.5
no page references them: every page loads rk.css + rk.js instead.

They are parked here rather than deleted so the pre-Phase-1.5 look can still be
diffed against. Nothing on the live site links to this folder; it can be
removed from the deploy at any time.

Everything script.js did still exists, in rk.js:
  · mobile menu      -> rk.js §04 (fullscreen panel, focus trap, Escape)
  · FAQ accordion    -> replaced by native <details>, which needs no JS
  · Web3Forms submit -> rk.js §10, same endpoint / key / FormData
  · gallery filter   -> removed with the old gallery (see rk.css §26)
  · lightbox         -> rk.js §09, rewritten with focus management
