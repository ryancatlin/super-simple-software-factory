#!/usr/bin/env -S uv run
# /// script
# dependencies = []
# ///
"""/install — stamp the SSSF factory from the skill into the cwd. Idempotent.

Usage:
    uv run <skill>/scripts/install.py [--force]

Stamps: adws/ (modules + starter ADWs), adws/adw_data/prompt_engineering/
(4 starter agents), adws/adw_sssf_config/sssf.config.yaml, .env.sample,
.gitignore entries.
Existing files are skipped unless --force.
"""

import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

TEMPLATES = Path(__file__).resolve().parent.parent / "templates"

DEFAULT_REPO = "https://github.com/ryancatlin/super-simple-software-factory.git"
DEFAULT_BRANCH = "main"
MANIFEST_REL = "adws/adw_sssf_config/stamp_manifest.json"

# The factory (adws/, justfile, .env.sample) is COMMITTED; only runtime
# noise is ignored. Unanchored patterns so a trace db / node_modules / dist
# are never committed wherever they turn up (e.g. the visualizer under
# .claude/ after `just obs` bun-installs it).
#
# .claude/skills/sssf/ is IGNORED — deliberately diverging from upstream's
# example branch, which must track it because it IS the skill repo and has
# no updater. Here the skill copy is regenerable: quickstart materializes
# it, update.py force-refreshes it, and the stamp manifest tracks its state
# on disk. Committing it would churn ~100 files on every update.
GITIGNORE_ENTRIES = [
    "adws/adw_data/sessions/",
    "sssf.db*",
    "__pycache__/",
    "*.py[cod]",
    "node_modules/",
    "dist/",
    ".claude/skills/sssf/",
    # env files are secrets, but the stamped .env.sample is meant to be
    # committed (it is a template, not a secret) — match upstream's
    # `!.env.example` / `!.env.sample` carve-outs.
    ".env",
    ".env.*",
    "!.env.example",
    "!.env.sample",
]


def stamp(src: Path, dest: Path, force: bool, stamped: list, skipped: list,
          manifest_files: dict) -> None:
    if src.is_dir():
        for child in sorted(src.iterdir()):
            if child.name == "__pycache__":
                continue
            stamp(child, dest / child.name, force, stamped, skipped,
                  manifest_files)
        return
    if dest.exists() and not force:
        skipped.append(str(dest))
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    stamped.append(str(dest))
    # Manifest keys are relative to the project root so update.py (run from
    # any checkout of the repo) can diff the same files.
    try:
        rel = str(dest.relative_to(Path.cwd()))
    except ValueError:
        rel = str(dest)
    manifest_files[rel] = sha256(src)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def ensure_gitignore(root: Path, stamped: list) -> None:
    gitignore = root / ".gitignore"
    existing = gitignore.read_text().splitlines() if gitignore.exists() else []
    missing = [e for e in GITIGNORE_ENTRIES if e not in existing]
    if missing:
        with gitignore.open("a") as f:
            f.write("\n# sssf runtime\n" + "\n".join(missing) + "\n")
        stamped.append(f"{gitignore} (+{len(missing)} entries)")


PI_SETTINGS = ".pi/settings.json"


def ensure_pi_settings(root: Path, stamped: list, skipped: list) -> None:
    """Wire pi to the project's Claude Code skills (.pi/settings.json).

    Merges, never clobbers: an existing file keeps its keys, and the
    "skills" array gains the project skill dir if it is not already there.
    """
    path = root / PI_SETTINGS
    desired = "../.claude/skills"
    if path.is_file():
        try:
            data = json.loads(path.read_text())
            if not isinstance(data, dict):
                data = {}
        except json.JSONDecodeError:
            data = {}
        skills = data.get("skills")
        if isinstance(skills, list) and desired in skills:
            skipped.append(f"{PI_SETTINGS} (pi already wired)")
            return
        if not isinstance(skills, list):
            skills = []
        skills.append(desired)
        data["skills"] = skills
    else:
        data = {"skills": [desired]}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")
    stamped.append(f"{PI_SETTINGS} (pi -> {desired})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="overwrite existing files")
    args = parser.parse_args()

    root = Path.cwd()
    stamped, skipped = [], []
    manifest_files: dict = {}

    stamp(TEMPLATES / "adws", root / "adws", args.force, stamped, skipped,
          manifest_files)
    stamp(TEMPLATES / "prompt_engineering",
          root / "adws" / "adw_data" / "prompt_engineering", args.force,
          stamped, skipped, manifest_files)
    stamp(TEMPLATES / "harness_engineering",
          root / "adws" / "adw_data" / "harness_engineering", args.force,
          stamped, skipped, manifest_files)
    stamp(TEMPLATES / "sssf.config.yaml",
          root / "adws" / "adw_sssf_config" / "sssf.config.yaml",
          args.force, stamped, skipped, manifest_files)
    stamp(TEMPLATES / "env.sample", root / ".env.sample", args.force,
          stamped, skipped, manifest_files)
    # The recipes are part of the operating experience, and several cookbooks
    # plus the run banner tell you to use them, so a stamped repo has to have
    # them. Skipped like any other file if the repo already has a justfile.
    stamp(TEMPLATES / "justfile", root / "justfile", args.force, stamped,
          skipped, manifest_files)
    ensure_gitignore(root, stamped)
    ensure_pi_settings(root, stamped, skipped)

    # The stamp manifest records what was stamped and the template hash of
    # each file, so update.py can refresh unmodified files and keep local
    # edits. Re-stamps merge into it (skipped files are untouched, so their
    # recorded hashes stay valid).
    manifest_path = root / MANIFEST_REL
    if manifest_path.is_file():
        try:
            prev = json.loads(manifest_path.read_text())
            manifest_files = {**prev.get("files", {}), **manifest_files}
        except json.JSONDecodeError:
            pass
    manifest = {
        "source": {"repo": DEFAULT_REPO, "branch": DEFAULT_BRANCH},
        "stamped_at": datetime.now(timezone.utc).isoformat(),
        "files": dict(sorted(manifest_files.items())),
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    stamped.append(f"{MANIFEST_REL} (stamp manifest)")

    print(f"sssf installed into {root}")
    print(f"  stamped: {len(stamped)} file(s)")
    for s in stamped:
        print(f"    + {s}")
    if skipped:
        print(f"  skipped (already exist, use --force to overwrite): {len(skipped)}")
    print("\nnext steps:")
    print("  1. cp .env.sample .env   # then set the key(s) your roster needs")
    print("  2. just demo             # two cheap read-only runs, end to end")
    print("  3. just sessions         # what just happened")
    print("  4. just obs              # the trace UI, needs bun")
    print("\n  no just? the raw form of step 2 is:")
    print("     uv run adws/adw_prompt.py \"say hello\" --agent scout")
    return 0


if __name__ == "__main__":
    sys.exit(main())
