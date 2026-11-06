#!/usr/bin/env python3
"""Reproducible, deliberately conservative docs-regression inventory.

This is a partial Markdown/GitHub-form parser and a lexical candidate finder, not a
replacement for human review. Baseline and candidate should use the same label file.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote, urlsplit

import yaml

FORM_TYPES = {"markdown", "input", "textarea", "dropdown", "checkboxes"}
LABEL = re.compile(r"\b(?:status|phase|agent|to|type|size|priority|env):[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?")
LINK = re.compile(r"!?\[[^\[\]\n]+\]\(([^()\n]+)\)")
BRACKET = re.compile(r"\[([^\[\]\n]{1,120})\](?!\s*(?:\(|\[))")
PROJECT_PATTERN = re.compile("|".join(("FONO" + "TEXT", "ФОНО" + "ТЕКСТ")), re.I)
FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
INLINE_CODE = re.compile(r"`+[^`\n]*`+")


def markdown_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.md") if not any(
        part in {".git", "node_modules", "__pycache__", ".venv"} for part in p.relative_to(root).parts
    ))


def form_errors(root: Path) -> dict[str, list[str]]:
    errors: dict[str, list[str]] = {}
    files = sorted((root / ".github" / "ISSUE_TEMPLATE").glob("*.y*ml"))
    if not files:
        return {".github/ISSUE_TEMPLATE": ["No issue form files found"]}
    for path in files:
        rel = path.relative_to(root).as_posix()
        found: list[str] = []
        try:
            doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError) as exc:
            errors[rel] = [f"YAML parse error: {exc}"]
            continue
        if not isinstance(doc, dict):
            errors[rel] = ["Root must be a mapping"]
            continue
        for field in ("name", "description"):
            if not isinstance(doc.get(field), str) or not doc[field].strip():
                found.append(f"Missing string: {field}")
        body = doc.get("body")
        if not isinstance(body, list) or not body:
            found.append("body must be a non-empty list")
            body = []
        ids: set[str] = set()
        for index, item in enumerate(body, 1):
            if not isinstance(item, dict):
                found.append(f"body[{index}] must be a mapping")
                continue
            kind = item.get("type")
            if kind not in FORM_TYPES:
                found.append(f"body[{index}] unsupported type {kind!r}")
                continue
            attrs = item.get("attributes")
            if not isinstance(attrs, dict):
                found.append(f"body[{index}] attributes must be a mapping")
                continue
            required_field = "value" if kind == "markdown" else "label"
            if not isinstance(attrs.get(required_field), str) or not attrs[required_field].strip():
                found.append(f"body[{index}] missing string attributes.{required_field}")
            if kind != "markdown":
                element_id = item.get("id")
                if element_id is not None:
                    if not isinstance(element_id, str) or not element_id:
                        found.append(f"body[{index}] invalid id")
                    elif element_id in ids:
                        found.append(f"body[{index}] duplicate id {element_id}")
                    else:
                        ids.add(element_id)
            if kind in {"dropdown", "checkboxes"}:
                options = attrs.get("options")
                if not isinstance(options, list) or not options:
                    found.append(f"body[{index}] options must be a non-empty list")
                elif kind == "dropdown" and not all(isinstance(o, str) for o in options):
                    found.append(f"body[{index}] dropdown options must be strings")
                elif kind == "checkboxes":
                    for opt_index, opt in enumerate(options, 1):
                        if not isinstance(opt, dict) or not isinstance(opt.get("label"), str):
                            found.append(f"body[{index}] checkbox option {opt_index} needs label")
                        elif "required" in opt and not isinstance(opt["required"], bool):
                            found.append(f"body[{index}] checkbox option {opt_index} required must be boolean")
            validations = item.get("validations", {})
            if not isinstance(validations, dict):
                found.append(f"body[{index}] validations must be a mapping")
            elif "required" in validations and not isinstance(validations["required"], bool):
                found.append(f"body[{index}] validations.required must be boolean")
        if found:
            errors[rel] = found
    return errors


def inventory(root: Path, live_labels: set[str] | None) -> dict:
    links: list[dict] = []
    project_hits: list[dict] = []
    candidates: list[dict] = []
    labels: dict[str, list[str]] = defaultdict(list)
    md_files = markdown_files(root)
    for path in md_files:
        rel = path.relative_to(root).as_posix()
        fence_char = None
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            loc = f"{rel}:{number}"
            m = FENCE.match(line)
            if m:
                char = m.group(1)[0]
                if fence_char is None:
                    fence_char = char
                elif char == fence_char:
                    fence_char = None
            if PROJECT_PATTERN.search(line):
                project_hits.append({"file": rel, "line": number, "text": line.strip()[:200]})
            for label in LABEL.findall(line):
                labels[label].append(loc)
            bracket = [m.group(1) for m in BRACKET.finditer(line)
                       if m.group(1).strip().lower() not in {"", "x"}]
            todo = bool(re.search(r"\bTODO\b", line, re.I))
            if todo or bracket:
                candidates.append({"file": rel, "line": number, "text": line.strip()[:200],
                                   "in_fence": fence_char is not None,
                                   "kind": "TODO" if todo else "bracket"})
            if fence_char is not None or m:
                continue
            text = INLINE_CODE.sub("", line)
            for match in LINK.finditer(text):
                target = match.group(1).strip().split(None, 1)[0].strip("<>")
                parsed = urlsplit(target)
                if parsed.scheme or parsed.netloc or not parsed.path:
                    continue
                path_text = unquote(parsed.path)
                destination = (root / path_text.lstrip("/")) if path_text.startswith("/") else (path.parent / path_text)
                if not destination.exists():
                    links.append({"file": rel, "line": number, "target": target})
    forms_dir = root / ".github" / "ISSUE_TEMPLATE"
    for path in sorted(forms_dir.glob("*.y*ml")):
        rel = path.relative_to(root).as_posix()
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for label in LABEL.findall(line):
                labels[label].append(f"{rel}:{number}")
    # Include static, unprefixed flags defined in the canonical label creation script.
    script = root / "docs" / "create-labels.sh"
    if script.exists():
        for number, line in enumerate(script.read_text(encoding="utf-8").splitlines(), 1):
            match = re.match(r'\s*create\s+"([^"$]+)"', line)
            if match:
                labels[match.group(1)].append(f"docs/create-labels.sh:{number}")
    missing = None if live_labels is None else {
        name: locations for name, locations in sorted(labels.items()) if name not in live_labels
    }
    return {
        "root": str(root),
        "markdown_files": len(md_files),
        "broken_links": links,
        "project_name_hits": project_hits,
        "form_errors": form_errors(root),
        "label_names_scanned": len(labels),
        "live_label_count": None if live_labels is None else len(live_labels),
        "missing_labels": missing,
        "placeholder_candidates": candidates,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--labels-json", type=Path, help="JSON from gh label list --limit 1000 --json name")
    parser.add_argument("--output", type=Path, help="write complete findings as JSON")
    args = parser.parse_args()
    root = args.root.resolve()
    live = None
    if args.labels_json:
        try:
            data = json.loads(args.labels_json.read_text(encoding="utf-8"))
            if not isinstance(data, list) or not all(isinstance(item, dict) and isinstance(item.get("name"), str) for item in data):
                raise ValueError("expected list of {name: string}")
            live = {item["name"] for item in data}
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            print(f"Could not read labels: {exc}", file=sys.stderr)
            return 2
    result = inventory(root, live)
    if args.output:
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Root: {root}")
    print(f"Markdown files: {result['markdown_files']}")
    print(f"Broken local links (partial Markdown parser): {len(result['broken_links'])}")
    print(f"Known project-name hits (all Markdown, including history): {len(result['project_name_hits'])}")
    print(f"Issue forms with local schema errors: {len(result['form_errors'])}")
    missing = result["missing_labels"]
    print("Absent lexical label candidates (review context): " + ("NOT CHECKED (no --labels-json)" if missing is None else str(len(missing))))
    print(f"Placeholder candidates requiring contextual review: {len(result['placeholder_candidates'])}")
    # Candidate placeholders and names include historical examples; they are a
    # review warning, not automatically a violation. Missing label input is not success.
    if result["broken_links"] or result["project_name_hits"] or result["form_errors"] or missing is None or missing:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
