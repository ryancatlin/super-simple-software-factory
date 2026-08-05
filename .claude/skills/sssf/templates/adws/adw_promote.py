#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pyyaml"]
# ///
"""ADW Promote — a probe becomes a floor flow, deliberately.

Usage:
    uv run adws/adw_promote.py <probe_name>

Probes are request-scoped acceptance journeys: they run only when a run's
coverage mapping cites them, so the always-on floor stays minimal. When a probe
has proven itself the journey it evidences is permanent, promotion makes that
explicit: the script moves from flows/probes/ up into flows/, its declaration
entry moves from `probes:` to `flows:`, and its `# Probe:` header becomes
`# Flow:`. Deliberate and visible — never automatic — which is exactly what
keeps the floor a curated regression suite instead of an accretion.

Commit the result like any declaration change. Note: validation.yaml is
re-serialized, so YAML comments in it are not preserved.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

DECLARATION = Path("adws/adw_data/validation/validation.yaml")
FLOWS_DIR = Path("adws/adw_data/validation/flows")
PROBES_DIR = FLOWS_DIR / "probes"


def main(name: str) -> int:
    if not DECLARATION.is_file():
        print(f"error: no declaration at {DECLARATION}", file=sys.stderr)
        return 2
    decl = yaml.safe_load(DECLARATION.read_text()) or {}
    probes = decl.get("probes") or []
    entry = next((p for p in probes if p.get("name") == name), None)
    if entry is None:
        known = ", ".join(p.get("name", "?") for p in probes) or "(none)"
        print(f"error: no probe named {name!r} declared. Probes: {known}",
              file=sys.stderr)
        return 2

    src = Path(entry["script"])
    dst = FLOWS_DIR / src.name
    if dst.exists():
        print(f"error: {dst} already exists — rename the probe first", file=sys.stderr)
        return 2
    if src.is_file():
        text = src.read_text().replace("# Probe:", "# Flow:", 1)
        dst.write_text(text)
        src.unlink()
    else:
        print(f"warning: declared script {src} not found on disk; "
              f"moving the declaration entry only", file=sys.stderr)

    entry["script"] = str(dst)
    decl["probes"] = [p for p in probes if p.get("name") != name]
    decl.setdefault("flows", []).append(entry)
    DECLARATION.write_text(yaml.safe_dump(decl, sort_keys=False))
    print(f"promoted {name}: {src} -> {dst}, declaration entry moved probes: -> flows:")
    print("it now runs on EVERY validation pass. Commit the declaration change.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", help="the declared probe name to promote")
    sys.exit(main(parser.parse_args().name))
