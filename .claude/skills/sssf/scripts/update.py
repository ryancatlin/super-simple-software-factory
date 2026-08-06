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
import os
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
    "adws/adw_data/validation",
    ".env",
)

# Never copied into the skill copy, so never pruned from it either — build
# output and caches are the project's own, not the skill's to delete.
SKILL_SKIP = ("__pycache__", "node_modules", "dist")


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


def source_head(skill: Path) -> tuple[str, int] | tuple[None, None]:
    """(sha, committer unix time) of the commit this skill dir came from.

    Works on the --depth 1 clone the fetch path keeps: one commit is all this
    needs. Returns (None, None) when the dir is not in a git repo — a plain
    --source copy is unverifiable, not an error.
    """
    try:
        out = subprocess.run(["git", "-C", str(skill), "log", "-1", "--format=%H %ct"],
                             capture_output=True, text=True, check=False)
    except OSError:
        return None, None
    parts = out.stdout.split()
    if out.returncode != 0 or len(parts) != 2:
        return None, None
    try:
        return parts[0], int(parts[1])
    except ValueError:
        return None, None


def _when(unix_time: int) -> str:
    return datetime.fromtimestamp(unix_time, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def check_freshness(manifest: dict, sha: str | None, commit_time: int | None,
                    allow_older: bool) -> bool:
    """False when the fetched source is provably older than what we stamped from.

    Staleness is the invisible failure this guards: an unpushed factory means
    origin still serves yesterday's templates, which silently revert today's
    fixes and only surface as a run misbehaving days later.
    """
    recorded_time = (manifest.get("source") or {}).get("commit_time")
    if allow_older or not isinstance(recorded_time, int) or commit_time is None:
        return True
    if commit_time >= recorded_time:
        return True
    recorded_sha = (manifest.get("source") or {}).get("commit") or "unknown"
    print(f"error: the fetched source is older than what this project was "
          f"stamped from\n"
          f"  fetched:  {(sha or 'unknown')[:12]}  {_when(commit_time)}\n"
          f"  stamped:  {recorded_sha[:12]}  {_when(recorded_time)}\n"
          f"  push the factory repo, or pass --source <dir> to update from a "
          f"local copy, or --allow-older to proceed anyway.", file=sys.stderr)
    return False


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
        ("validation", "adws/adw_data/validation"),
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
            dest_hash = sha256(dest)
            if recorded == dest_hash:
                # unmodified since stamp -> refresh to the new template
                if not dry:
                    shutil.copy2(child, dest)
                files[rel] = sha256(child)
                report["refreshed"].append(rel)
            elif recorded is not None:
                # The hash diverged, but divergence is not proof of a local
                # edit: a template hand-copied in to unblock work looks
                # identical to one. Left alone, such a file is kept forever and
                # every later template fix has to be hand-synced twice.
                new_hash = sha256(child)
                old_tmpl = (root / ".claude" / "skills" / "sssf" / "templates"
                            / rel_src / child.name)
                if dest_hash == new_hash:
                    files[rel] = new_hash
                    report["refreshed"].append(f"{rel} (re-baselined)")
                elif old_tmpl.is_file() and dest_hash == sha256(old_tmpl):
                    # Verbatim some template version, so never locally authored.
                    # The old skill copy is still the OLD one here: _refresh_skill
                    # runs after this walk.
                    if not dry:
                        shutil.copy2(child, dest)
                    files[rel] = new_hash
                    report["refreshed"].append(f"{rel} (re-baselined from template)")
                else:
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
                # Same re-baseline reasoning as walk(): a hand-synced copy of
                # the template must not be mistaken for a local edit.
                new_hash = sha256(src)
                dest_hash = sha256(dest)
                old_tmpl = (root / ".claude" / "skills" / "sssf" / "templates"
                            / src_rel)
                if dest_hash == new_hash:
                    files[rel] = new_hash
                    report["refreshed"].append(f"{rel} (re-baselined)")
                elif old_tmpl.is_file() and dest_hash == sha256(old_tmpl):
                    if not dry:
                        shutil.copy2(src, dest)
                    files[rel] = new_hash
                    report["refreshed"].append(f"{rel} (re-baselined from template)")
                else:
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
        _refresh_skill(skill, skill_dest, ".claude/skills/sssf",
                       files, report, dry)
        _prune_skill(skill, skill_dest, ".claude/skills/sssf",
                     files, report, dry)
    else:
        if not dry:
            skill_dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(skill, skill_dest,
                            ignore=shutil.ignore_patterns("__pycache__",
                                                          "node_modules",
                                                          "dist"))
            # record every copied file's hash so future updates can diff them
            for p in skill_dest.rglob("*"):
                if p.is_file() and p.name not in ("__pycache__",):
                    try:
                        rel = f".claude/skills/sssf/{p.relative_to(skill_dest)}"
                    except ValueError:
                        continue
                    files[rel] = sha256(p)
        report["added"].append(".claude/skills/sssf/ (full skill copy)")

    # Files recorded but no longer shipped: left in place, reported.
    # (Skill-copy files are exempt — _prune_skill already deleted the ones
    # the source no longer ships and dropped them from the manifest.)
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


def _refresh_skill(src_dir: Path, dest_dir: Path, rel_prefix: str,
                   files: dict, report: dict, dry: bool) -> None:
    """Force-refresh the skill copy: the skill is the machine, not user-owned.

    rel_prefix carries the FULL path from the skill root (e.g.
    ".claude/skills/sssf/apps/visualizer/server/db.ts") so manifest keys stay
    unique — a bare basename would collide across nested dirs (system.md
    exists in every agent's prompt_engineering/).
    """
    for child in sorted(src_dir.iterdir()):
        if child.name in SKILL_SKIP:
            continue
        rel = f"{rel_prefix}/{child.name}"
        dest = dest_dir / child.name
        if child.is_dir():
            if not dry:
                dest.mkdir(parents=True, exist_ok=True)
            _refresh_skill(child, dest, rel, files, report, dry)
        else:
            if not dry:
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(child, dest)
            files[rel] = sha256(child)
            report["refreshed"].append(rel)


def _prune_skill(src_dir: Path, dest_dir: Path, rel_prefix: str,
                 files: dict, report: dict, dry: bool) -> None:
    """Delete skill-copy files the source skill no longer ships.

    The skill copy is a mirror, not an accretion: a file dropped upstream
    (a Vue component replaced by React, a retired script) must not linger in
    the target repo where it would still be read, imported, or executed.
    Only ever called with dest_dir inside .claude/skills/sssf — nothing
    outside the skill copy is a candidate for deletion.
    """
    if not dest_dir.is_dir() or dest_dir.is_symlink():
        return
    for child in sorted(dest_dir.iterdir()):
        if child.name in SKILL_SKIP:
            continue
        rel = f"{rel_prefix}/{child.name}"
        src = src_dir / child.name
        if child.is_symlink():
            # A symlink is never something the refresh wrote; leave it alone.
            continue
        if child.is_dir():
            _prune_skill(src, child, rel, files, report, dry)
            if not src.is_dir() and not dry and not any(child.iterdir()):
                child.rmdir()
            continue
        if src.is_file():
            continue
        if not dry:
            child.unlink()
        files.pop(rel, None)
        report["removed"].append(rel)


def ensure_gitignore(root: Path, report: dict, dry: bool) -> None:
    gitignore = root / ".gitignore"
    # Factory committed, runtime noise ignored; .claude/skills/sssf/ ignored
    # because it is regenerable (quickstart materializes, update refreshes,
    # the manifest tracks it) — committing it would churn ~100 files per
    # update. .env.sample re-included: committed template, not a secret.
    entries = [
        "adws/adw_data/sessions/",
        "sssf.db*",
        "__pycache__/",
        "*.py[cod]",
        "node_modules/",
        "dist/",
        ".claude/skills/sssf/",
        ".env",
        ".env.*",
        "!.env.example",
        "!.env.sample",
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
    ap.add_argument("--allow-older", action="store_true",
                    help="proceed even if the fetched source predates this stamp")
    args = ap.parse_args()

    root = Path.cwd()
    if not (root / "adws").is_dir():
        print("error: no adws/ here — run from a stamped project root",
              file=sys.stderr)
        return 2

    manifest = load_manifest(root)
    report = {"refreshed": [], "kept": [], "added": [], "orphaned": [],
              "removed": []}

    if args.dry_run:
        print(f"[update] DRY RUN against {root}")
    else:
        print(f"[update] updating {root}")

    skill = fetch_source(args)
    sha, commit_time = source_head(skill)
    if sha:
        print(f"[update] source {sha[:12]} ({_when(commit_time)})")
    else:
        print("[update] source is not a git checkout — commit unknown")
    # Only the fetch path can prove staleness: a --source copy is whatever the
    # operator pointed at, deliberately.
    if not args.source and not check_freshness(manifest, sha, commit_time,
                                               args.allow_older):
        return 2

    if not args.dry_run:
        # Self-heal: if the updater running here is older than the one in
        # the fetched source (updater changed mid-project-life), re-exec the
        # source's copy BEFORE doing any work, so the new logic (pi wiring,
        # gitignore, manifest keys) runs in THIS invocation — one `just
        # update`, always converges. The fresh copy finds itself current and
        # does not re-exec. Runs from the fetched cache dir; cwd and args
        # are preserved.
        running = Path(__file__).resolve()
        src_updater = (skill / "scripts" / "update.py").resolve()
        if (running != src_updater and src_updater.is_file()
                and sha256(src_updater) != sha256(running)):
            print("[update] updater is stale — re-running as the fresh copy")
            sys.stdout.flush()   # execv replaces the process; don't lose the line
            os.execv(sys.executable, [sys.executable, str(src_updater)]
                     + sys.argv[1:])
        update_tree(skill, root, manifest, False, report)
        manifest["stamped_at"] = datetime.now(timezone.utc).isoformat()
        source = {"repo": args.repo or DEFAULT_REPO,
                  "branch": args.branch or DEFAULT_BRANCH}
        if sha:
            source["commit"] = sha
            source["commit_time"] = commit_time
        else:
            # Unverifiable source: keep the last known-good commit rather than
            # erasing the baseline the freshness check needs.
            for key in ("commit", "commit_time"):
                if key in (manifest.get("source") or {}):
                    source[key] = manifest["source"][key]
        manifest["source"] = source
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
    if report["removed"]:
        print(f"  removed (no longer in the skill): {len(report['removed'])}")
        for x in report["removed"]:
            print(f"    x {x}")
    if report["orphaned"]:
        print(f"  no longer shipped, left in place: {len(report['orphaned'])}")
        for x in report["orphaned"]:
            print(f"    - {x}")
    print("\n[update] done — nothing was force-overwritten.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
