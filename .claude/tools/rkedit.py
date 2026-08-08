#!/usr/bin/env python3
"""Safe CSS editing primitives for rk.css.

BANNED: text.index(<generic css>) / any first-match splice. Every operation
below asserts UNIQUENESS and writes NOTHING when an assertion fails.
"""


class EditError(Exception):
    pass


def replace_unique(text, old, new, label=""):
    """Replace `old` with `new`. Raises unless `old` occurs EXACTLY once."""
    n = text.count(old)
    if n != 1:
        raise EditError(f"{label or 'replace_unique'}: old occurs {n}x, need exactly 1 "
                        f"(old[:80]={old[:80]!r})")
    return text.replace(old, new, 1)


def replace_between_unique(text, start_marker, end_marker, new, label="",
                           keep_markers=False):
    """Replace the span between two markers. Both must occur exactly once and
    start must precede end."""
    ns, ne = text.count(start_marker), text.count(end_marker)
    if ns != 1:
        raise EditError(f"{label}: start marker occurs {ns}x, need 1 ({start_marker[:60]!r})")
    if ne != 1:
        raise EditError(f"{label}: end marker occurs {ne}x, need 1 ({end_marker[:60]!r})")
    a, b = text.index(start_marker), text.index(end_marker)
    if not a < b:
        raise EditError(f"{label}: start ({a}) must precede end ({b})")
    if keep_markers:
        return text[:a] + start_marker + new + end_marker + text[b + len(end_marker):]
    return text[:a] + new + text[b:]


def replace_to_eof_after_unique(text, anchor, following, new, label=""):
    """Replace from the first occurrence of `following` AFTER the unique
    `anchor` through end of file. Guards the ambiguous-anchor bug: `following`
    may legitimately appear more than once, but `anchor` must be unique."""
    na = text.count(anchor)
    if na != 1:
        raise EditError(f"{label}: anchor occurs {na}x, need 1 ({anchor[:60]!r})")
    a = text.index(anchor)
    i = text.find(following, a)
    if i == -1:
        raise EditError(f"{label}: {following[:60]!r} not found after anchor")
    j = text.find(following, i + 1)
    if j != -1:
        raise EditError(f"{label}: {following[:60]!r} occurs again at {j} after anchor "
                        f"— span is ambiguous")
    return text[:i] + new


def insert_before_unique(text, marker, new, label=""):
    n = text.count(marker)
    if n != 1:
        raise EditError(f"{label}: marker occurs {n}x, need 1 ({marker[:60]!r})")
    i = text.index(marker)
    return text[:i] + new + text[i:]
