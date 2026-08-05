#!/usr/bin/env -S uv run
# /// script
# dependencies = []
# ///
"""/update — handsfree, non-breaking refresh of a stamped SSSF project.

Fetches the latest skill (from the fork recorded at stamp time, or --source)
and updates the stamped files with a diff policy:

  - unmodified since stamp (matches the manifest hash)  -> refreshed
  - modified by the project                              -> KEPT, reported
  - new in the template                                  -> added
  - in the manifest but gone from the template           -> left in place
  - user-owned (sssf.config.yaml, prompt_engineering/,
    harness_engineering/, .env)                          -> never overwritten
                                                           (add-only)

Never prompts. Never force-overwrites. Safe to run twice.

Usage:
    uv run .claude/skills/sssf/scripts/update.py                 # fetch + update
    uv run .claude/skills/sssf/scripts/update.py --source <dir>  # from a local copy
    uv run .claude/skills/sssf/scripts/update.py --dry-run       # preview only
    uv run .claude/skills/sssf/scripts/update.py --repo <url> --branch <b>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_REPO = "https://github.com/ryancatlin/super-simple-software-factory.git"
DEFAULT_BRANCH = "main"
CACHE_ROOT = Path.home() / ".cache" / "sssf-update"

# Relative to the project root. Add-only, never overwritten.
USER_OWNED = (
    "adws/adw_sssf_config/sssf.config.yaml",
    "adws/adw_data/prompt_engineering",
    "adws/adw_data/harness_engineering",
    ".env",
)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def load_manifest(root: Path) -> dict:
    path = root / "adws" / "adw_sssf_config" / "stamp_manifest.json"
    if path.is_file():
        return json.loads(path.read_text())
    return {"source": {"repo": DEFAULT_REPO, "branch": DEFAULT_BRANCH},
            "stamped_at": "", "files": {}}


def save_manifest(root: Path, manifest: dict) -> None:
    path = root / "adws" / "adw_sssf_config" / "stamp_manifest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2) + "\n")


def fetch_source(args) -> Path:
    """Return a skill dir (containing .claude/skills/sssf or the skill itself)."""
    if args.source:
        src = Path(args.source).resolve()
        skill = src / ".claude" / "skills" / "sssf" if (src / ".claude").exists() else src
        if not (skill / "templates").is_dir():
            print(f"error: no skill found at {src}", file=sys.stderr)
            sys.exit(2)
        return skill

    repo = args.repo or DEFAULT_REPO
    branch = args.branch or DEFAULT_BRANCH
    slug = repo.rstrip("/").split("/")[-1].removesuffix(".git")
    cache = CACHE_ROOT / f"{slug}-{branch}"
    cache.mkdir(parents=True, exist_ok=True)

    if not (cache / ".git").exists():
        print(f"[update] cloning {repo} ({branch}) -> {cache}")
        subprocess.run(["git", "clone", "--depth", "1", "-b", branch,
                        repo, str(cache)], check=True, capture_output=True)
    else:
        print(f"[update] refreshing {cache}")
        subprocess.run(["git", "-C", str(cache), "fetch", "origin", branch,
                        "--depth", "1"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(cache), "reset", "--hard",
                        f"origin/{branch}"], check=True, capture_output=True)
    return cache / ".claude" / "skills" / "sssf"


def update_tree(skill: Path, root: Path, manifest: dict, dry: bool,
                report: dict) -> None:
    """Apply the diff policy over templates/ -> stamped locations."""
    files = manifest["files"]
    template = skill / "templates"

    # Map template-relative path -> project-relative destination.
    mappings = [
        ("adws", "adws"),
        ("prompt_engineering", "adws/adw_data/prompt_engineering"),
        ("harness_engineering", "adws/adw_data/harness_engineering"),
        ("sssf.config.yaml", "adws/adw_sssf_config/sssf.config.yaml"),
        ("env.sample", ".env.sample"),
        ("justfile", "justfile"),
    ]

    def is_user_owned(rel: str) -> bool:
        """True when rel is a user-owned path or sits under one (add-only)."""
        return any(rel == u or rel.startswith(u + "/") for u in USER_OWNED)


    def walk(src_dir: Path, dest_dir: Path) -> None:
        rel_src = src_dir.relative_to(template)
        for child in sorted(src_dir.iterdir()):
            if child.name == "__pycache__":
                continue
            rel = f"{dest_dir.relative_to(root)}/{child.name}"
            dest = dest_dir / child.name
            if child.is_dir():
                walk(child, dest)
                continue
            if is_user_owned(rel):
                # add-only: user-owned content is never overwritten
                if dest.exists():
                    report["kept"].append(f"{rel} (user-owned)")
                else:
                    if not dry:
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(child, dest)
                    report["added"].append(rel)
                continue
            if not dest.exists():
                if not dry:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(child, dest)
                files[rel] = sha256(child)
                report["added"].append(rel)
                continue
            recorded = files.get(rel)
            if recorded == sha256(dest):
                # unmodified since stamp -> refresh to the new template
                if not dry:
                    shutil.copy2(child, dest)
                files[rel] = sha256(child)
                report["refreshed"].append(rel)
            elif recorded is not None:
                report["kept"].append(f"{rel} (modified locally)")
            else:
                # Pre-manifest stamp: no baseline, so compare against the project's
                # OWN old skill copy (still intact until we refresh it below) to
                # tell a pristine-old file from a local edit. Only refresh the
                # provably pristine; a local edit stays unmanaged and kept.
                new_hash = sha256(child)
                if sha256(dest) == new_hash:
                    files[rel] = new_hash
                    report["kept"].append(f"{rel} (already current)")
                else:
                    old_tmpl = root / ".claude" / "skills" / "sssf" / "templates" / rel_src / child.name
                    if old_tmpl.is_file() and sha256(dest) == sha256(old_tmpl):
                        if not dry:
                            shutil.copy2(child, dest)
                        files[rel] = new_hash
                        report["refreshed"].append(f"{rel} (old stamp -> current)")
                    else:
                        report["kept"].append(f"{rel} (unmanaged, kept)")

    for src_rel, dest_rel in mappings:
        src = template / src_rel
        dest = root / dest_rel
        if src.is_dir():
            walk(src, dest)
        elif src.is_file():
            rel = dest_rel
            if is_user_owned(rel):
                if dest.exists():
                    report["kept"].append(f"{rel} (user-owned)")
                else:
                    if not dry:
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(src, dest)
                    report["added"].append(rel)
                continue
            if not dest.exists():
                if not dry:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dest)
                files[rel] = sha256(src)
                report["added"].append(rel)
            elif files.get(rel) == sha256(dest):
                if not dry:
                    shutil.copy2(src, dest)
                files[rel] = sha256(src)
                report["refreshed"].append(rel)
            elif files.get(rel) is not None:
                report["kept"].append(f"{rel} (modified locally)")
            else:
                # Pre-manifest stamp: compare against the project's old skill
                # copy to tell pristine-old from local edit (see walk()).
                new_hash = sha256(src)
                if sha256(dest) == new_hash:
                    files[rel] = new_hash
                    report["kept"].append(f"{rel} (already current)")
                else:
                    old_tmpl = root / ".claude" / "skills" / "sssf" / "templates" / src_rel
                    if old_tmpl.is_file() and sha256(dest) == sha256(old_tmpl):
                        if not dry:
                            shutil.copy2(src, dest)
                        files[rel] = new_hash
                        report["refreshed"].append(f"{rel} (old stamp -> current)")
                    else:
                        report["kept"].append(f"{rel} (unmanaged, kept)")

    # Refresh the skill copy itself — framework, ALWAYS (the skill's own
    # convention: prompts are edited in adws/adw_data/prompt_engineering/,
    # never inside the skill). An old stamp's copy lacks update.py itself,
    # so the first update must bring the whole machine up to date.
    skill_dest = root / ".claude" / "skills" / "sssf"
    if skill_dest.is_symlink():
        report["kept"].append(".claude/skills/sssf (symlink — not refreshed;"
                              " point it at a real copy and re-run)")
    elif skill_dest.is_dir():
        _refresh_skill(skill, skill_dest, files, report, dry)
    else:
        if not dry:
            skill_dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(skill, skill_dest)
        report["added"].append(".claude/skills/sssf/ (full skill copy)")

    # Files recorded but no longer shipped: left in place, reported.
    # (Skill-copy files are exempt — they are always fully refreshed.)
    shipped = set()
    for src_rel, dest_rel in mappings:
        src = template / src_rel
        if src.is_dir():
            for p in src.rglob("*"):
                if p.is_file():
                    shipped.add(f"{dest_rel}/{p.relative_to(src)}")
        else:
            shipped.add(dest_rel)
    for rel in sorted(set(files) - shipped):
        if rel.startswith(".claude/skills/sssf/"):
            continue
        report["orphaned"].append(rel)


def _refresh_skill(src_dir: Path, dest_dir: Path, files: dict, report: dict,
                   dry: bool) -> None:
    """Force-refresh the skill copy: the skill is the machine, not user-owned."""
    for child in sorted(src_dir.iterdir()):
        if child.name == "__pycache__":
            continue
        rel = f".claude/skills/sssf/{child.name}"
        dest = dest_dir / child.name
        if child.is_dir():
            if not dry:
                dest.mkdir(parents=True, exist_ok=True)
            _refresh_skill(child, dest, files, report, dry)
        else:
            if not dry:
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(child, dest)
            files[rel] = sha256(child)
            report["refreshed"].append(rel)


def ensure_gitignore(root: Path, report: dict, dry: bool) -> None:
    gitignore = root / ".gitignore"
    entries = [
        "adws/adw_data/sessions/", "adws/adw_data/sssf.db*", ".env",
        "__pycache__/", "*.pyc",
    ]
    existing = gitignore.read_text().splitlines() if gitignore.exists() else []
    missing = [e for e in entries if e not in existing]
    if missing and not dry:
        with gitignore.open("a") as f:
            f.write("\n# sssf runtime\n" + "\n".join(missing) + "\n")
    if missing:
        report["refreshed"].append(f".gitignore (+{len(missing)} entries)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", help="local skill dir or fork clone (skip fetch)")
    ap.add_argument("--repo", help=f"fork URL (default {DEFAULT_REPO})")
    ap.add_argument("--branch", help=f"branch (default {DEFAULT_BRANCH})")
    ap.add_argument("--dry-run", action="store_true", help="preview only, change nothing")
    args = ap.parse_args()

    root = Path.cwd()
    if not (root / "adws").is_dir():
        print("error: no adws/ here — run from a stamped project root",
              file=sys.stderr)
        return 2

    manifest = load_manifest(root)
    report = {"refreshed": [], "kept": [], "added": [], "orphaned": []}

    if args.dry_run:
        print(f"[update] DRY RUN against {root}")
    else:
        print(f"[update] updating {root}")

    skill = fetch_source(args)
    if not args.dry_run:
        update_tree(skill, root, manifest, False, report)
        manifest["stamped_at"] = datetime.now(timezone.utc).isoformat()
        manifest["source"] = {"repo": args.repo or DEFAULT_REPO,
                              "branch": args.branch or DEFAULT_BRANCH}
        save_manifest(root, manifest)
        ensure_gitignore(root, report, False)
    else:
        update_tree(skill, root, manifest, True, report)

    print(f"\n  refreshed: {len(report['refreshed'])}")
    for x in report["refreshed"]:
        print(f"    ~ {x}")
    print(f"  added: {len(report['added'])}")
    for x in report["added"]:
        print(f"    + {x}")
    print(f"  kept (your version): {len(report['kept'])}")
    for x in report["kept"]:
        print(f"    = {x}")
    if report["orphaned"]:
        print(f"  no longer shipped, left in place: {len(report['orphaned'])}")
        for x in report["orphaned"]:
            print(f"    - {x}")
    print("\n[update] done — nothing was force-overwritten.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
