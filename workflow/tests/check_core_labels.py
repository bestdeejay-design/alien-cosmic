#!/usr/bin/env python3
"""Expand the pinned label script against a fake gh, never the real GitHub API.

Extra labels (present in the live snapshot but absent from the plan) are checked
report-only: their count is always printed, and the full list is printed with
--report-extra. Extra labels NEVER change the exit code — cleanup of stale
labels is a human decision (issue #106 / R2-06), the script must never delete
or fail on them.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

# Refuse to execute an altered script: its behaviour needs a fresh safety review.
SAFE_SCRIPT_SHA256 = "01d1a9a51afd7d5500c105beefce014b8fcdea12d03ea8af9a0899745a16202e"


def planned_labels(root: Path, *, project_config: Path | None = None) -> list[str]:
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
        if project_config is not None:
            env["AGENT_PROJECT_CONFIG"] = str(project_config)
        subprocess.run(["bash", str(script)], cwd=root, env=env, check=True, capture_output=True, text=True)
        return capture.read_text(encoding="utf-8").splitlines()


def planned_label_specs(root: Path, *, project_config: Path | None = None) -> dict[str, str]:
    """Expand the pinned label script against a fake gh, capturing name -> description.

    Same safety hash as planned_labels: the script must not change without a
    fresh review and a pinned-hash update. The fake gh records "name\\tdescription"
    (argv: label create NAME --color C --description D).
    """
    script = root / "docs" / "create-labels.sh"
    if hashlib.sha256(script.read_bytes()).hexdigest() != SAFE_SCRIPT_SHA256:
        raise ValueError("create-labels.sh changed; review it and update the pinned hash before running")
    with tempfile.TemporaryDirectory(prefix="agent-label-mock-") as directory:
        temporary = Path(directory)
        fake = temporary / "gh"
        fake.write_text(
            '#!/bin/sh\n'
            'if [ "$1" != label ] || [ "$2" != create ] || [ "$#" -lt 7 ]; then exit 98; fi\n'
            'printf "%s\\t%s\\n" "$3" "$7" >> "$AGENT_LABEL_CAPTURE"\n', encoding="utf-8")
        fake.chmod(0o755)
        capture = temporary / "labels.tsv"
        env = os.environ.copy()
        env["PATH"] = f"{temporary}{os.pathsep}{env.get('PATH', '')}"
        env["AGENT_LABEL_CAPTURE"] = str(capture)
        if project_config is not None:
            env["AGENT_PROJECT_CONFIG"] = str(project_config)
        subprocess.run(["bash", str(script)], cwd=root, env=env, check=True, capture_output=True, text=True)
        specs: dict[str, str] = {}
        for line in capture.read_text(encoding="utf-8").splitlines():
            name, _, description = line.partition("\t")
            specs[name] = description
        return specs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--labels-json", type=Path, required=True)
    parser.add_argument("--project-config", type=Path, help="Optional project.json overlay path")
    parser.add_argument(
        "--report-extra", action="store_true",
        help="Print the full list of extra labels (live but not planned); report-only, exit code unaffected",
    )
    args = parser.parse_args()
    planned = planned_labels(args.root.resolve(), project_config=args.project_config)
    live = {entry["name"] for entry in json.loads(args.labels_json.read_text(encoding="utf-8"))}
    missing = sorted(set(planned) - live)
    extra = sorted(live - set(planned))
    duplicates = len(planned) - len(set(planned))
    print(f"Pinned script expanded using fake gh: {len(planned)} labels; duplicates: {duplicates}")
    print(f"Compared to label snapshot: {len(live)} names; missing core labels: {len(missing)}")
    if missing:
        print("Missing:", ", ".join(missing))
    # Report-only: extra labels are informational, they never fail the check.
    print(f"Extra labels (live, not in plan): {len(extra)}")
    if extra and args.report_extra:
        print("Extra:", ", ".join(extra))
    return 1 if missing or duplicates else 0


if __name__ == "__main__":
    raise SystemExit(main())
