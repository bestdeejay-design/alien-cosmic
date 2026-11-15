#!/usr/bin/env python3
"""Purity & Portability Gate (ADR-0003) + reproducible docs/forms/labels regression checker.

Verifies without network access that a canon checkout or project installation (root or
`<project>/workflow/` subdirectory):
  1) has 0 broken local Markdown links (including `docs/history/` when present);
  2) has 0 hardcoded private agent/platform/project/account names outside `docs/history/`;
  3) has valid `.github/ISSUE_TEMPLATE/*.yml` forms matching the core schema;
  4) uses no undeclared `status:|phase:|agent:|to:|type:|size:|priority:|env:` labels
     outside `schema/bus.json` + optional `project.json` + neutral doc examples;
  5) keeps `.claude/` and `.agents/` mirrors byte-identical to `agents/` and `skills/`.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote, urlsplit

# PyYAML нужен ТОЛЬКО для парсинга YAML-форм issues (.github/ISSUE_TEMPLATE/*.yml).
# Импорт ленивый (внутри form_errors), поэтому на чистом Python без PyYAML скрипт
# работает и проверяет всё остальное, а пропуск проверки форм печатается явно —
# квитанция никогда не выдаёт непроверенное за проверенное (issue #79, H-03).
FORMS_SKIP_KEY = "_forms_skipped"


def yaml_available() -> bool:
    try:
        import yaml  # noqa: F401
    except ModuleNotFoundError:
        return False
    return True


FORM_TYPES = {"markdown", "input", "textarea", "dropdown", "checkboxes"}
LABEL = re.compile(r"\b(?:status|phase|agent|to|type|size|priority|env):[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?")
LINK = re.compile(r"!?\[[^\[\]\n]+\]\(([^()\n]+)\)")
BRACKET = re.compile(r"\[([^\[\]\n]{1,120})\](?!\s*(?:\(|\[))")
PROJECT_PATTERN = re.compile("|".join(("FONO" + "TEXT", "ФОНО" + "ТЕКСТ")), re.I)

# Denylist tokens built from neutral fragments so this file itself never trips raw grep scans.
_DENY_FRAGMENTS = (
    r"\b" + "s" + "z" + r"-[0-9]+\b",
    r"\b" + "s" + "z" + r"-pool\b",
    r"(?<!%)\b" + "S" + "Z" + r"\b",
    r"\b" + "S" + "Z" + r"-[0-9]+\b",
    r"\bto:" + "ar" + "ena" + r"\b",
    r"\b" + "ar" + "ena" + r"/[A-Za-z0-9_.-]+",
    "Ар" + "ен" + r"[аеыуой]\b",
    r"\b" + "Z" + "Code" + r"\b",
    "FONO" + "TEXT",
    "фоно" + "текст",
    "alien" + "-" + "cosmic",
    "bestdeejay" + "-" + "design",
)
PURITY_PATTERN = re.compile("|".join(f"(?:{p})" for p in _DENY_FRAGMENTS), re.I)
CASE_SENSITIVE_TWO_LETTER = re.compile(r"(?<!%)\b" + "S" + "Z" + r"\b")

FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
INLINE_CODE = re.compile(r"`+[^`\n]*`+")

IGNORED_DIRS = {".git", "node_modules", "__pycache__", ".venv", ".pytest_cache", ".mypy_cache"}
# Рантайм-состояние инструментов (в .gitignore): custodian хранит в нём снимки вывода
# check-команд живого проекта (#127), там законно появляются реальные имена узлов.
IGNORED_FILES = {".custodian-state.json"}
# Живое письмо поставки (docs/MAIL.md на кончике ветки, формат — тот же файл в main):
# по WORKFLOW §4.4 / AGENT_RULES §4.4 оно ОБЯЗАНО называть реальную ветку поставки,
# следующий адресат из ростера project.json и имя проекта (issue #83, M-01) —
# поэтому письмо выведено из сканов чистоты/проектных имён. Нейтральный образец
# в main и workflow/docs/MAIL.md (режим B) исключаются так же.
MAIL_REL_PATHS = {"docs/MAIL.md", "workflow/docs/MAIL.md"}
# to:infra (#159) — адресатная метка проектного слоя (не ядро schema/bus.json): канон
# упоминает её как адрес шины, создаётся оверлеем/владельцем в каждом репо.
DOC_EXAMPLE_ROSTER_LABELS = {"to:worker-1", "to:worker-2", "to:worker-5", "to:sandbox-1", "to:infra"}
TEXT_SUFFIXES = {".md", ".yml", ".yaml", ".json", ".py", ".sh", ".txt"}


def is_history_rel(rel: str) -> bool:
    return rel == "docs/history" or rel.startswith("docs/history/")


def resolve_forms_dir(root: Path) -> Path:
    direct = root / ".github" / "ISSUE_TEMPLATE"
    if direct.is_dir():
        return direct
    parent = root.parent / ".github" / "ISSUE_TEMPLATE"
    if parent.is_dir():
        return parent
    return direct


def markdown_files(root: Path, *, include_history: bool = True) -> list[Path]:
    out: list[Path] = []
    for p in sorted(root.rglob("*.md")):
        rel_parts = p.relative_to(root).parts
        if any(part in IGNORED_DIRS for part in rel_parts):
            continue
        rel = p.relative_to(root).as_posix()
        if not include_history and is_history_rel(rel):
            continue
        out.append(p)
    return out


def live_canon_files(root: Path, *, include_history: bool = False) -> list[Path]:
    files: list[Path] = []
    seen: set[Path] = set()

    def _consider(p: Path, base: Path) -> None:
        rp = p.resolve()
        if rp in seen or not p.is_file():
            return
        rel_parts = p.relative_to(base).parts
        if any(part in IGNORED_DIRS for part in rel_parts):
            return
        rel = p.relative_to(base).as_posix()
        if not include_history and is_history_rel(rel):
            return
        if rel in IGNORED_FILES:
            return
        if rel in MAIL_REL_PATHS:
            # Живое письмо поставки обязано называть реальные ветки/адресатов (#83, M-01).
            return
        if rel in {"project.json", "workflow/project.json"}:
            # Проектный оверлей — единственное санкционированное место для имён
            # сабов/проектов/аккаунтов (ADR-0003): корневой project.json и
            # workflow/project.json (режим B, ADOPTION §5); стерильный
            # project.example.json остаётся под сканом.
            return
        if p.suffix.lower() in TEXT_SUFFIXES or p.parent.name in {"scripts", ".githooks"}:
            seen.add(rp)
            files.append(p)

    for p in sorted(root.rglob("*")):
        _consider(p, root)

    # Also scan host `.github/` when canon lives inside `<project>/workflow/`
    if not (root / ".github").is_dir() and (root.parent / ".github").is_dir():
        for p in sorted((root.parent / ".github").rglob("*")):
            _consider(p, root.parent)

    return files


def purity_violations(root: Path, *, include_history: bool = False) -> list[dict]:
    hits: list[dict] = []
    for path in live_canon_files(root, include_history=include_history):
        try:
            rel = path.relative_to(root).as_posix()
        except ValueError:
            rel = path.relative_to(root.parent).as_posix()
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for lineno, line in enumerate(content.splitlines(), 1):
            m = PURITY_PATTERN.search(line)
            if not m:
                continue
            token = m.group(0)
            # Avoid case-insensitive false positives on short two-letter legacy fleet code unless uppercase or hyphenated
            if len(token) == 2 and not CASE_SENSITIVE_TWO_LETTER.search(line):
                continue
            hits.append({
                "file": rel,
                "line": lineno,
                "token": token,
                "text": line.strip()[:200],
            })
    return hits


def default_expected_labels(root: Path) -> set[str]:
    expected: set[str] = set(DOC_EXAMPLE_ROSTER_LABELS)
    schema_path = root / "schema" / "bus.json"
    if schema_path.is_file():
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        for grp in schema.get("label_groups", {}).values():
            for entry in grp.get("values", []):
                expected.add(entry["name"])

    scripts_dir = root / "scripts"
    if (scripts_dir / "project_overlay.py").is_file():
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        from project_overlay import load_overlay, overlay_labels  # type: ignore

        overlay = load_overlay(root)
        for item in overlay_labels(overlay):
            expected.add(item["name"])
    return expected


def check_mirror_sync(root: Path) -> list[str]:
    install_script = root / "scripts" / "install-skills"
    if not install_script.is_file():
        return []
    if (root / ".claude").is_dir() or (root / ".agents").is_dir():
        res = subprocess.run(
            [sys.executable, str(install_script), "--check"],
            cwd=root,
            text=True,
            capture_output=True,
            check=False,
        )
        if res.returncode != 0:
            msg = (res.stderr.strip() or res.stdout.strip()).splitlines()
            return msg or ["install-skills --check failed"]
        return []
    # Subdirectory layout where mirrors were rolled out to `<project>/.claude` & `<project>/.agents`
    if root.name == "workflow" and ((root.parent / ".claude").is_dir() or (root.parent / ".agents").is_dir()):
        # Сверка делегируется install-skills --check --project-root: он сверяет ПОЛНОЕ
        # дерево каждого навыка (SKILL.md + support/ и пр.) и карточки ролей (#107, R2-07).
        res = subprocess.run(
            [sys.executable, str(install_script), "--check", "--project-root", str(root.parent)],
            cwd=root,
            text=True,
            capture_output=True,
            check=False,
        )
        if res.returncode != 0:
            msg = (res.stderr.strip() or res.stdout.strip()).splitlines()
            return msg or ["install-skills --check --project-root failed"]
        return []
    return ["missing native CLI mirrors (.claude / .agents); run python3 scripts/install-skills"]


def form_errors(root: Path) -> dict[str, list[str]]:
    try:
        import yaml  # noqa: F401
    except ModuleNotFoundError:
        # Явная пометка пропуска вместо ложной «проверенности» форм (issue #79, H-03).
        # inventory() отделяет этот ключ от реальных ошибок форм.
        return {
            FORMS_SKIP_KEY: [
                "PyYAML не установлен — проверка YAML-форм issues пропущена "
                "(установите: python3 -m pip install -r tests/requirements.txt)"
            ]
        }
    errors: dict[str, list[str]] = {}
    forms_dir = resolve_forms_dir(root)
    # config.yml / config.yaml — зарезервированный файл настроек GitHub Issue Forms
    # (blank_issues_enabled, contact_links), схемы form-шаблона не требует (issue #83, M-04).
    reserved = {"config.yml", "config.yaml"}
    files = [p for p in sorted(forms_dir.glob("*.y*ml")) if p.name.lower() not in reserved] if forms_dir.is_dir() else []
    if not files:
        return {".github/ISSUE_TEMPLATE": ["No issue form files found"]}
    for path in files:
        try:
            rel = path.relative_to(root).as_posix()
        except ValueError:
            rel = path.relative_to(root.parent).as_posix()
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


def pilots_violations(root: Path) -> list[dict]:
    """R2-02 (audit #98, пилот custodians #127): в живом каноне нет НОВЫХ каталогов
    pilots/<имя>/.

    Каталоги `pilots/` — песочницы пилотов с данными, которых не должно быть в
    стерильном каноне. Уже существующие (санитизированные) имена занесены в белый
    список `tests/pilots_baseline.json` ({"allow": [...]}); правило детектирует только
    появление новых pilots/<x>/ — гейт падает, пока имя не внесено в baseline
    осознанным коммитом. Это выбранное поведение: белый список вместо «детекта любых»,
    чтобы существующие легальные песочницы не шумели при каждом прогоне.
    Зеркала .claude/.agents не сканируются отдельно: побайтовая идентичность с
    skills/ гарантируется check_mirror_sync, история — docs/history/ исключена.
    """
    allow: set[str] = set()
    baseline_path = root / "tests" / "pilots_baseline.json"
    if baseline_path.is_file():
        try:
            data = json.loads(baseline_path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("allow"), list):
                allow = {str(name) for name in data["allow"]}
        except (OSError, json.JSONDecodeError):
            pass
    hits: list[dict] = []
    for path in sorted(root.rglob("pilots")):
        if not path.is_dir():
            continue
        rel = path.relative_to(root).as_posix()
        if is_history_rel(rel) or rel.startswith((".claude/", ".agents/")) or any(
            part in IGNORED_DIRS for part in rel.split("/")
        ):
            continue
        for child in sorted(path.iterdir()):
            if not child.is_dir():
                continue
            name = child.name
            if name not in allow:
                hits.append({"file": f"{rel}/{name}", "token": "R2-02", "text": "новый каталог pilots/<имя>/ в живом каноне"})
    return hits


def inventory(root: Path, live_labels: set[str] | None, *, include_history: bool = False) -> dict:
    links: list[dict] = []
    project_hits: list[dict] = []
    candidates: list[dict] = []
    labels: dict[str, list[str]] = defaultdict(list)

    all_md_files = markdown_files(root, include_history=True)
    live_md_count = 0
    history_md_count = 0

    for path in all_md_files:
        rel = path.relative_to(root).as_posix()
        in_hist = is_history_rel(rel)
        if in_hist:
            history_md_count += 1
        else:
            live_md_count += 1

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

            if (not in_hist or include_history) and rel not in MAIL_REL_PATHS and PROJECT_PATTERN.search(line):
                project_hits.append({"file": rel, "line": number, "text": line.strip()[:200]})

            if not in_hist or include_history:
                for label in LABEL.findall(line):
                    labels[label].append(loc)
                bracket = [bm.group(1) for bm in BRACKET.finditer(line)
                           if bm.group(1).strip().lower() not in {"", "x"}]
                todo = bool(re.search(r"\bTODO\b", line, re.I))
                if todo or bracket:
                    candidates.append({"file": rel, "line": number, "text": line.strip()[:200],
                                       "in_fence": fence_char is not None,
                                       "kind": "TODO" if todo else "bracket"})

            # Broken link scan ALWAYS runs on every Markdown file (including docs/history/)
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
                    # If a target project intentionally omitted docs/history/ per ADOPTION.md §5,
                    # links into the omitted archive directory are expected and not broken links.
                    hist_root = (root / "docs" / "history").resolve()
                    dest_resolved = destination.resolve()
                    if not hist_root.exists() and (dest_resolved == hist_root or hist_root in dest_resolved.parents):
                        continue
                    links.append({"file": rel, "line": number, "target": target})

    forms_dir = resolve_forms_dir(root)
    if forms_dir.is_dir():
        for path in sorted(forms_dir.glob("*.y*ml")):
            try:
                rel = path.relative_to(root).as_posix()
            except ValueError:
                rel = path.relative_to(root.parent).as_posix()
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                for label in LABEL.findall(line):
                    labels[label].append(f"{rel}:{number}")

    script = root / "docs" / "create-labels.sh"
    if script.exists():
        for number, line in enumerate(script.read_text(encoding="utf-8").splitlines(), 1):
            match = re.match(r'\s*create\s+"([^"$]+)"', line)
            if match:
                labels[match.group(1)].append(f"docs/create-labels.sh:{number}")

    missing = None if live_labels is None else {
        name: locations for name, locations in sorted(labels.items()) if name not in live_labels
    }
    p_violations = purity_violations(root, include_history=include_history)
    pilot_violations = pilots_violations(root)
    m_errors = check_mirror_sync(root)

    raw_form_errors = form_errors(root)
    forms_skipped = raw_form_errors.pop(FORMS_SKIP_KEY, None)

    return {
        "root": str(root),
        "markdown_files": len(all_md_files),
        "live_markdown_files": live_md_count,
        "history_markdown_files": history_md_count,
        "broken_links": links,
        "project_name_hits": project_hits,
        "purity_violations": p_violations,
        "pilots_violations": pilot_violations,
        "form_errors": raw_form_errors,
        "forms_skipped": forms_skipped,
        "label_names_scanned": len(labels),
        "live_label_count": None if live_labels is None else len(live_labels),
        "missing_labels": missing,
        "mirror_errors": m_errors,
        "placeholder_candidates": candidates,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--labels-json", type=Path, help="Optional JSON from gh label list (defaults to schema/bus.json + project.json)")
    parser.add_argument("--include-history", action="store_true", help="Also scan docs/history/ for historical project/agent names")
    parser.add_argument("--output", type=Path, help="Write complete findings as JSON")
    args = parser.parse_args(argv)
    root = args.root.resolve()

    if args.labels_json:
        try:
            data = json.loads(args.labels_json.read_text(encoding="utf-8"))
            if not isinstance(data, list) or not all(isinstance(item, dict) and isinstance(item.get("name"), str) for item in data):
                raise ValueError("expected list of {name: string}")
            live = {item["name"] for item in data} | set(DOC_EXAMPLE_ROSTER_LABELS)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            print(f"Could not read labels: {exc}", file=sys.stderr)
            return 2
    else:
        try:
            live = default_expected_labels(root)
        except ValueError as exc:
            print(f"Invalid project.json overlay: {exc}", file=sys.stderr)
            return 2

    result = inventory(root, live, include_history=args.include_history)
    if args.output:
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    missing = result["missing_labels"] or {}
    print(f"Root: {root}")
    print(
        f"Markdown files: {result['markdown_files']} "
        f"(live canon: {result['live_markdown_files']}, archived history: {result['history_markdown_files']})"
    )
    print(f"Broken local links: {len(result['broken_links'])}")
    print(f"Purity violations (hardcoded fleet/platform/project names): {len(result['purity_violations'])}")
    print(f"New pilot sandbox dirs (R2-02): {len(result['pilots_violations'])}")
    print(f"Issue forms with local schema errors: {len(result['form_errors'])}")
    if result.get("forms_skipped"):
        print(f"Issue forms: SKIPPED ({result['forms_skipped'][0]})")
    print(f"Undeclared label tokens: {len(missing)}")
    print(f"Native CLI mirror drift (.claude / .agents): {len(result['mirror_errors'])}")

    failed = False
    if result["broken_links"]:
        failed = True
        for b in result["broken_links"][:10]:
            print(f"  BROKEN LINK: {b['file']}:{b['line']} -> {b['target']}", file=sys.stderr)
    if result["purity_violations"]:
        failed = True
        for v in result["purity_violations"][:15]:
            print(f"  PURITY VIOLATION: {v['file']}:{v['line']} [{v['token']}] {v['text']}", file=sys.stderr)
    if result["pilots_violations"]:
        failed = True
        for v in result["pilots_violations"]:
            print(f"  PILOTS VIOLATION ({v['token']}): {v['file']} — {v['text']}", file=sys.stderr)
    if result["form_errors"]:
        failed = True
        for fpath, ferrs in result["form_errors"].items():
            print(f"  FORM ERROR: {fpath}: {ferrs}", file=sys.stderr)
    if missing:
        failed = True
        for lbl, locs in list(missing.items())[:15]:
            print(f"  UNDECLARED LABEL: {lbl} at {', '.join(locs[:3])}", file=sys.stderr)
    if result["mirror_errors"]:
        failed = True
        for merr in result["mirror_errors"]:
            print(f"  MIRROR DRIFT: {merr}", file=sys.stderr)

    if failed:
        print("PURITY & PORTABILITY GATE FAILED", file=sys.stderr)
        return 1

    print("PURITY & PORTABILITY GATE OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
