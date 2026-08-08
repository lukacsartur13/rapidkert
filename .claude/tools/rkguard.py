#!/usr/bin/env python3
"""Structural guard for rk.css. Run BEFORE and AFTER every mutation.

Balanced braces are NOT enough — this checks size floors, every required
numbered section heading, and the critical selectors.

usage:  python3 rkguard.py <file> [--baseline <file>]
exit 0 = PASS, 1 = FAIL
"""
import sys, re, os

LINE_FLOOR = 3700
BYTE_FLOOR = 175000

SECTIONS = ["31 —", "31.1 —", "31.2 —", "31.3 —", "31.35 —", "31.4 —", "31.5 —",
            "31.55 —", "31.6 —", "31.7 —", "31.8 —", "31.9 —",
            "32 —", "32.0 —", "32.1 —", "32.2 —", "32.3 —", "32.4 —", "32.5 —",
            "32.6 —", "32.7 —", "32.8 —", "32.9 —", "32.10 —", "33 —"]

SELECTORS = [".gd", ".gd__datum", ".gd__stage", ".gd__photo",
             ".fld", ".fld__pl", ".fld__cut", ".fld__deep", ".fld__datum",
             ".lyr", ".lyr__stage", ".lyr__world", ".lyr__type",
             ".asm", ".asm__stage", ".asm__world", ".asm__datum", ".asm__stations",
             ".prf", ".prf__stage", ".prf__world", ".prf__slot",
             ".brg", ".brg__plate", ".sheet", ".sheet__grid", ".grd", ".wrl__"]

# the Phase 2.2 handover contract: REALITY -> PROJECTS is one image
CONTRACTS = [
    (r"\.fld\{[^}]*margin-top:\s*-100svh", "CONTRACT 2: .fld negative-viewport overlap"),
    (r"\.gd\.is-handed", "CONTRACT 2: .gd.is-handed handover"),
    (r"--datum:\s*46%", "CONTRACT: shared --datum token"),
]


def check(path, verbose=True):
    s = open(path, encoding="utf-8").read()
    lines = s.count("\n") + 1
    fails, warns = [], []

    if lines < LINE_FLOOR:
        fails.append(f"line count {lines} < floor {LINE_FLOOR}")
    if len(s.encode()) < BYTE_FLOOR:
        fails.append(f"byte size {len(s.encode())} < floor {BYTE_FLOOR}")

    for sec in SECTIONS:
        if s.count(sec) < 1:
            fails.append(f"missing section heading: {sec}")

    for sel in SELECTORS:
        # a selector written as a BEM stem (".wrl__") matches any of its elements;
        # a complete selector must not be a prefix of a longer one
        pat = re.escape(sel) if sel.endswith("__") else re.escape(sel) + r"(?![\w-])"
        if not re.search(pat, s):
            fails.append(f"missing critical selector: {sel}")

    for pat, why in CONTRACTS:
        if not re.search(pat, s):
            fails.append(f"broken contract: {why}")

    # brace balance, comments stripped
    t = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    depth, neg = 0, None
    for ch in t:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth < 0 and neg is None:
                neg = True
    if depth != 0:
        fails.append(f"unbalanced braces: final depth {depth}")
    if neg:
        fails.append("brace depth went negative")

    # ambiguous-anchor canary
    n1024 = s.count("@media (max-width:1024px){")
    if n1024 < 2:
        warns.append(f"@media (max-width:1024px){{ occurs {n1024}x "
                     "(expected >=2: §31.8 and §32.9)")

    if verbose:
        print(f"  file    : {path}")
        print(f"  lines   : {lines}   bytes: {len(s.encode())}")
        print(f"  sections: {len(SECTIONS) - sum(1 for f in fails if 'section heading' in f)}/{len(SECTIONS)}")
        for w in warns:
            print(f"  WARN    : {w}")
        for f in fails:
            print(f"  FAIL    : {f}")
        print("  RESULT  :", "PASS" if not fails else "FAIL")
    return fails


if __name__ == "__main__":
    p = sys.argv[1]
    sys.exit(1 if check(p) else 0)
