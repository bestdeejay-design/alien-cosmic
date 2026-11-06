#!/usr/bin/env python3
"""Expand the pinned label script against a fake gh, never the real GitHub API."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

# Refuse to execute an altered script: its behaviour needs a fresh safety review.
SAFE_SCRIPT_SHA256 = "43d2e0d79aba4c1143d13670aea3f3cd8f6fae8388d393b361303aba8d2ee7ae"


def planned_labels(root: Path) -> list[str]:
    script = root / "docs" / "create-labels.sh"
    if hashlib.sha256(script.read_bytes()).hexdigest() != SAFE_SCRIPT_SHA256:
        raise ValueError("create-labels.sh changed; review it and update the pinned hash before running")
    with tempfile.TemporaryDirectory(prefix="agent-label-mock-") as directory:
        temporary = Path(directory)
        fake = temporary / "gh"
        fake.write_text(
            '#!/bin/sh\n'
            'if [ "$1" != label ] || [ "$2" != create ] || [ "$#" -lt 3 ]; then exit 98; fi\n'
            'printf "%s\\n" "$3" >> "$AGENT_LABEL_CAPTURE"\n', encoding="utf-8")
        fake.chmod(0o755)
        capture = temporary / "labels.txt"
        env = os.environ.copy()
        env["PATH"] = f"{temporary}{os.pathsep}{env.get('PATH', '')}"
        env["AGENT_LABEL_CAPTURE"] = str(capture)
        subprocess.run(["bash", str(script)], cwd=root, env=env, check=True, capture_output=True, text=True)
        return capture.read_text(encoding="utf-8").splitlines()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--labels-json", type=Path, required=True)
    args = parser.parse_args()
    planned = planned_labels(args.root.resolve())
    live = {entry["name"] for entry in json.loads(args.labels_json.read_text(encoding="utf-8"))}
    missing = sorted(set(planned) - live)
    duplicates = len(planned) - len(set(planned))
    print(f"Pinned script expanded using fake gh: {len(planned)} labels; duplicates: {duplicates}")
    print(f"Compared to label snapshot: {len(live)} names; missing core labels: {len(missing)}")
    if missing:
        print("Missing:", ", ".join(missing))
    return 1 if missing or duplicates else 0


if __name__ == "__main__":
    raise SystemExit(main())
