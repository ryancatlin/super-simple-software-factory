#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic", "python-dotenv", "pyyaml", "rich"]
# ///
"""ADW Bless — accept a run's screenshots as the visual-regression baselines.

Usage:
    uv run adws/adw_bless.py --adw-id a1b2c3d4

Copies every screenshot from the run's flow evidence dirs into
adws/adw_data/validation/baselines/<flow>/. Future captures diff against these
and record a drift score next to each screenshot. Baselines are user-owned
project source — review the screenshots you are blessing, then commit them
like the flows.

A known command is code: blessing is a copy, so it is a script, not an agent.
"""

import argparse
import sys

from adw_modules import services


def main(adw_id: str) -> int:
    blessed = services.bless_baselines(adw_id)
    if not blessed:
        print(f"nothing to bless: no screenshots under sessions/{adw_id}/"
              f"context_handoff/validation/", file=sys.stderr)
        return 1
    print(f"blessed {len(blessed)} baseline(s) from run {adw_id}:")
    for path in blessed:
        print(f"  + {path}")
    print("\nreview the images, then commit them — they are project source.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adw-id", required=True, help="the run whose screenshots become baselines")
    args = parser.parse_args()
    sys.exit(main(args.adw_id))
