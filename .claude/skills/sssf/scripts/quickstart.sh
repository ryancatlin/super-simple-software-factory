#!/usr/bin/env bash
# sssf quickstart — one-shot install of the SSSF factory into the CURRENT dir.
#
# For project hopping: cd into the project, run this, done. Idempotent-ish:
# refuses to clobber a repo that already has a stamped factory (use update
# there: `just update`).
#
# Usage:
#   bash <fork>/.claude/skills/sssf/scripts/quickstart.sh
#   SSSF_SOURCE=/path/to/fork bash <...>/quickstart.sh     # explicit source
#
# Source resolution: $SSSF_SOURCE, else the default local fork path, else a
# fresh clone of the GitHub fork (branch $SSSF_BRANCH, default main).

set -euo pipefail

DEFAULT_FORK="$HOME/Documents/GitHub/super-simple-software-factory"
REPO_URL="${SSSF_REPO:-https://github.com/ryancatlin/super-simple-software-factory.git}"
BRANCH="${SSSF_BRANCH:-main}"

if [ -f .claude/skills/sssf/SKILL.md ] || [ -d adws ]; then
  echo "this repo looks like it already has the factory (adws/ or"
  echo ".claude/skills/sssf present). If it is an OLD install, update it"
  echo "(keeps your edits, adds new files like the wait/kill scripts):"
  echo "    uv run ~/Documents/GitHub/super-simple-software-factory/.claude/skills/sssf/scripts/update.py --source ~/Documents/GitHub/super-simple-software-factory"
  echo "    # or once update.py is in place:  just update"
  exit 1
fi

# ── resolve the skill source ───────────────────────────────────────────────
SKILL_SRC="${SSSF_SOURCE:-}"
if [ -z "$SKILL_SRC" ] && [ -d "$DEFAULT_FORK/.claude/skills/sssf" ]; then
  SKILL_SRC="$DEFAULT_FORK"
fi
if [ -n "$SKILL_SRC" ] && [ ! -d "$SKILL_SRC/.claude/skills/sssf" ]; then
  echo "error: no skill at $SKILL_SRC/.claude/skills/sssf" >&2
  exit 1
fi

TMP_CLONE=""
if [ -z "$SKILL_SRC" ]; then
  TMP_CLONE="$(mktemp -d)"
  echo "[quickstart] cloning $REPO_URL ($BRANCH) ..."
  git clone --quiet --depth 1 -b "$BRANCH" "$REPO_URL" "$TMP_CLONE/fork"
  SKILL_SRC="$TMP_CLONE/fork"
fi
trap 'rm -rf "$TMP_CLONE"' EXIT

# ── stamp ──────────────────────────────────────────────────────────────────
mkdir -p .claude/skills
cp -r "$SKILL_SRC/.claude/skills/sssf" .claude/skills/
echo "[quickstart] stamping the factory..."
uv run .claude/skills/sssf/scripts/install.py
[ -f .env ] || cp .env.sample .env
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init -q && git commit --allow-empty -q -m init
fi

echo
echo "factory installed into $PWD"
echo "  next:  just demo      # two cheap read-only runs"
echo "         just obs       # web UI on :4601 (needs bun)"
echo "         just update    # handsfree refresh from the fork, keeps your edits"
