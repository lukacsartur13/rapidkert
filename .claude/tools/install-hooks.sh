#!/bin/sh
# Install the repo's git hooks. Hooks are not cloned with a repository, so
# run this once after `git clone`.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
git config core.hooksPath .claude/tools/githooks
mkdir -p .claude/tools/githooks
cp .claude/tools/pre-commit .claude/tools/githooks/pre-commit
chmod +x .claude/tools/githooks/pre-commit
echo "hooks installed: core.hooksPath -> .claude/tools/githooks"
echo "  pre-commit: rk.css structural guard"
