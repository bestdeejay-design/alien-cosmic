#!/usr/bin/env python3
"""project_overlay — чтение и валидация опционального проектного слоя project.json (ADR-0003).

Позволяет держать ядро канона (schema/bus.json, 46 базовых меток) полностью свободным от
имён конкретных агентов, веток и репозиториев, а в целевом проекте подключать ростер узлов,
префиксы веток, навыковый профиль стека и кастомные поля борда через один файл project.json.

Порядок поиска project.json (если не передан --project-config):
  1) переменная окружения AGENT_PROJECT_CONFIG (если непуста);
  2) <canon_root>/project.json;
  3) <canon_root>/../project.json (когда канон установлен в подкаталог <repo>/workflow/).
Если файл не найден — возвращается чистая конфигурация ядра по умолчанию.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$")
TO_LABEL_RE = re.compile(r"^to:[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$")
HEX_COLOR_RE = re.compile(r"^[0-9A-Fa-f]{6}$")
BRANCH_PREFIX_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")

DEFAULT_POOL_LABEL = "to:pool"
DEFAULT_BRANCH_PREFIXES = ["work", "ext", "agent"]
CORE_RESERVED_IDS = {"owner", "coordinator", "pool"}
VALID_NODE_MODES = {"direct_gh", "isolated_branch"}

# Роли фоновых агентов гигиены (custodians, пилот issue #127). Наблюдатель — обёртка
# над существующими скриптами; новый тип узла в schema/bus.json НЕ вводится.
VALID_CUSTODIAN_KINDS = {"schema-sentinel", "board-gardener", "doc-linter"}

GQL_COLOR_MAP = {
    "BLUE": "BLUE",
    "GREEN": "GREEN",
    "YELLOW": "YELLOW",
    "ORANGE": "ORANGE",
    "RED": "RED",
    "PURPLE": "PURPLE",
    "PINK": "PINK",
    "GRAY": "GRAY",
}


def resolve_overlay_path(canon_root: Path = ROOT, explicit_path: Path | str | None = None) -> Path | None:
    if explicit_path:
        p = Path(explicit_path)
        if not p.is_file():
            raise ValueError(f"файл конфигурации проекта не найден: {p}")
        return p.resolve()

    env_cfg = os.environ.get("AGENT_PROJECT_CONFIG", "").strip()
    if env_cfg:
        p = Path(env_cfg)
        if not p.is_file():
            raise ValueError(f"AGENT_PROJECT_CONFIG указывает на несуществующий файл: {p}")
        return p.resolve()

    direct = canon_root / "project.json"
    if direct.is_file():
        return direct.resolve()

    if canon_root.name == "workflow":
        parent_cfg = canon_root.parent / "project.json"
        if parent_cfg.is_file():
            return parent_cfg.resolve()

    return None


def default_overlay() -> dict:
    return {
        "loaded": False,
        "path": None,
        "schema_version": "1.0",
        "project": {"slug": "", "repo": "", "canon_prefix": ""},
        "pool_label": DEFAULT_POOL_LABEL,
        "branch_prefixes": list(DEFAULT_BRANCH_PREFIXES),
        "roster": [],
        "env_skills": [],
        "custom_board_fields": [],
        "custodians": [],
    }


def validate_and_normalize(raw: object, source: str = "project.json") -> dict:
    if not isinstance(raw, dict):
        raise ValueError(f"{source}: корень JSON должен быть объектом")

    out = default_overlay()
    out["loaded"] = True
    out["path"] = source
    out["schema_version"] = str(raw.get("schema_version", "1.0"))

    proj = raw.get("project", {})
    if proj is not None:
        if not isinstance(proj, dict):
            raise ValueError(f"{source}: поле 'project' должно быть объектом")
        out["project"] = {
            "slug": str(proj.get("slug", "")).strip(),
            "repo": str(proj.get("repo", "")).strip(),
            "canon_prefix": str(proj.get("canon_prefix", "")).strip().strip("/"),
        }

    pool_label = str(raw.get("pool_label", DEFAULT_POOL_LABEL)).strip()
    if not TO_LABEL_RE.match(pool_label):
        raise ValueError(f"{source}: некорректный pool_label {pool_label!r} (ожидается to:<slug>)")
    out["pool_label"] = pool_label

    raw_prefixes = raw.get("branch_prefixes", DEFAULT_BRANCH_PREFIXES)
    if not isinstance(raw_prefixes, list) or not raw_prefixes:
        raise ValueError(f"{source}: branch_prefixes должен быть непустым списком")
    prefixes: list[str] = []
    for bp in raw_prefixes:
        if not isinstance(bp, str) or not BRANCH_PREFIX_RE.match(bp.strip()):
            raise ValueError(f"{source}: некорректный префикс ветки {bp!r}")
        val = bp.strip()
        if val not in prefixes:
            prefixes.append(val)

    raw_roster = raw.get("roster", [])
    if not isinstance(raw_roster, list):
        raise ValueError(f"{source}: поле 'roster' должно быть списком узлов")
    seen_ids: set[str] = set()
    roster: list[dict] = []
    for idx, entry in enumerate(raw_roster, 1):
        if not isinstance(entry, dict):
            raise ValueError(f"{source}: roster[{idx}] должен быть объектом")
        node_id = str(entry.get("id", "")).strip()
        if not SLUG_RE.match(node_id):
            raise ValueError(f"{source}: roster[{idx}].id={node_id!r} не соответствует [a-z0-9][a-z0-9_-]*")
        if node_id in seen_ids:
            raise ValueError(f"{source}: дублирующийся id узла в roster: {node_id!r}")
        seen_ids.add(node_id)

        mode = str(entry.get("mode", "direct_gh")).strip()
        if mode not in VALID_NODE_MODES:
            raise ValueError(f"{source}: roster[{idx}].mode={mode!r} должен быть одним из {sorted(VALID_NODE_MODES)}")

        color = str(entry.get("color", "C5DEF5")).strip().lstrip("#").upper()
        if not HEX_COLOR_RE.match(color):
            raise ValueError(f"{source}: roster[{idx}].color={color!r} должен быть 6-значным HEX")

        bpref = str(entry.get("branch_prefix", "")).strip()
        if bpref:
            if not BRANCH_PREFIX_RE.match(bpref):
                raise ValueError(f"{source}: roster[{idx}].branch_prefix={bpref!r} некорректен")
            if bpref not in prefixes:
                prefixes.append(bpref)

        desc = str(entry.get("description", f"Текущий адресат: узел {node_id} ({mode})")).strip()
        board_color = str(entry.get("board_color", "GREEN" if mode == "direct_gh" else "PURPLE")).strip().upper()
        if board_color not in GQL_COLOR_MAP:
            board_color = "GREEN"

        roster.append({
            "id": node_id,
            "label": f"to:{node_id}",
            "name": str(entry.get("name", node_id)).strip() or node_id,
            "mode": mode,
            "branch_prefix": bpref,
            "color": color,
            "board_color": board_color,
            "description": desc,
        })

    out["branch_prefixes"] = prefixes
    out["roster"] = roster

    raw_skills = raw.get("env_skills", [])
    if not isinstance(raw_skills, list) or not all(isinstance(s, str) and s.strip() for s in raw_skills):
        raise ValueError(f"{source}: env_skills должен быть списком строк")
    out["env_skills"] = [s.strip() for s in raw_skills]

    raw_fields = raw.get("custom_board_fields", [])
    if not isinstance(raw_fields, list):
        raise ValueError(f"{source}: custom_board_fields должен быть списком")
    fields: list[dict] = []
    for idx, f in enumerate(raw_fields, 1):
        if not isinstance(f, dict) or not isinstance(f.get("name"), str) or not f["name"].strip():
            raise ValueError(f"{source}: custom_board_fields[{idx}] должен содержать строковое name")
        dtype = str(f.get("dataType", "SINGLE_SELECT")).strip().upper()
        if dtype not in {"SINGLE_SELECT", "TEXT", "NUMBER", "DATE"}:
            raise ValueError(f"{source}: custom_board_fields[{idx}].dataType={dtype!r} не поддерживается")
        item: dict = {"name": f["name"].strip(), "dataType": dtype}
        if dtype == "SINGLE_SELECT":
            opts = f.get("options", [])
            if not isinstance(opts, list) or not opts:
                raise ValueError(f"{source}: SINGLE_SELECT поле {item['name']!r} требует непустой options")
            norm_opts = []
            for opt in opts:
                if isinstance(opt, str) and opt.strip():
                    norm_opts.append({"name": opt.strip(), "color": "GRAY", "description": ""})
                elif isinstance(opt, dict) and isinstance(opt.get("name"), str) and opt["name"].strip():
                    c = str(opt.get("color", "GRAY")).strip().upper()
                    norm_opts.append({
                        "name": opt["name"].strip(),
                        "color": c if c in GQL_COLOR_MAP else "GRAY",
                        "description": str(opt.get("description", "")).strip(),
                    })
                else:
                    raise ValueError(f"{source}: некорректная опция в поле {item['name']!r}")
            item["options"] = norm_opts
        fields.append(item)
    out["custom_board_fields"] = fields

    # Роли фоновых агентов гигиены (custodians, пилот #127): [{id, kind, check, cadence}].
    # check — командная строка существующего скрипта/режима (запускается scripts/custodian
    # из корня канона); cadence — человекочитаемая периодичность, ядром не исполняется.
    raw_custodians = raw.get("custodians", [])
    if not isinstance(raw_custodians, list):
        raise ValueError(f"{source}: поле 'custodians' должно быть списком ролей")
    seen_custodian_ids: set[str] = set()
    custodians: list[dict] = []
    for idx, entry in enumerate(raw_custodians, 1):
        if not isinstance(entry, dict):
            raise ValueError(f"{source}: custodians[{idx}] должен быть объектом")
        cid = str(entry.get("id", "")).strip()
        if not SLUG_RE.match(cid):
            raise ValueError(f"{source}: custodians[{idx}].id={cid!r} не соответствует [a-z0-9][a-z0-9_-]*")
        if cid in seen_custodian_ids:
            raise ValueError(f"{source}: дублирующийся id роли custodian: {cid!r}")
        seen_custodian_ids.add(cid)
        kind = str(entry.get("kind", "")).strip()
        if kind not in VALID_CUSTODIAN_KINDS:
            raise ValueError(
                f"{source}: custodians[{idx}].kind={kind!r} должен быть одним из {sorted(VALID_CUSTODIAN_KINDS)}"
            )
        check = str(entry.get("check", "")).strip()
        if not check:
            raise ValueError(f"{source}: custodians[{idx}].check должен быть непустой командой существующего скрипта")
        cadence = str(entry.get("cadence", "")).strip()
        custodians.append({"id": cid, "kind": kind, "check": check, "cadence": cadence})
    out["custodians"] = custodians
    return out


def load_overlay(canon_root: Path = ROOT, explicit_path: Path | str | None = None) -> dict:
    cfg_path = resolve_overlay_path(canon_root, explicit_path)
    if cfg_path is None:
        return default_overlay()
    try:
        raw = json.loads(cfg_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"ошибка чтения {cfg_path}: {exc}") from exc
    return validate_and_normalize(raw, str(cfg_path))


def overlay_labels(overlay: dict) -> list[dict]:
    """Дополнительные метки поверх 46 базовых меток schema/bus.json."""
    extra: list[dict] = []
    seen = {"to:owner", "to:coordinator", "to:pool"}
    pool_lbl = overlay.get("pool_label", DEFAULT_POOL_LABEL)
    if pool_lbl not in seen:
        extra.append({
            "name": pool_lbl,
            "color": "1F6FEB",
            "description": f"Текущий адресат: проектный пул исполнителей ({pool_lbl})",
        })
        seen.add(pool_lbl)
    for node in overlay.get("roster", []):
        lbl = node["label"]
        if lbl not in seen:
            extra.append({
                "name": lbl,
                "color": node["color"],
                "description": node["description"],
            })
            seen.add(lbl)
    return extra


def validate_claim_as(slug: str, overlay: dict) -> str | None:
    """Возвращает текст ошибки или None, если slug допустим."""
    if not SLUG_RE.match(slug):
        return f"--claim-as={slug!r} должен быть корректным slug [a-z0-9][a-z0-9_-]*"
    roster = overlay.get("roster", [])
    if not overlay.get("loaded") or not roster:
        return None
    pool_id = overlay.get("pool_label", DEFAULT_POOL_LABEL).split(":", 1)[1]
    allowed = {n["id"] for n in roster} | CORE_RESERVED_IDS | {pool_id}
    if slug not in allowed:
        roster_ids = ", ".join(sorted(n["id"] for n in roster))
        return (
            f"--claim-as={slug!r} отсутствует в ростере project.json ({overlay.get('path')}); "
            f"допустимые узлы: {roster_ids}"
        )
    return None


def branch_regex(overlay: dict | None = None) -> re.Pattern[str]:
    """BRANCH_RE генерируется из branch_prefixes оверлея (issue #88/#143).

    Допустимые формы: `<prefix>/<NN>-<slug>` и безномерный `<prefix>/<slug>`
    (каноничная аудиторская поставка `audit/<slug>`, AGENT_RULES §4.1). Для
    безномерной формы номер не захватывается — связь с issue идёт через subjects
    коммитов (см. extract_issue_refs).
    """
    prefixes = (overlay or {}).get("branch_prefixes") or DEFAULT_BRANCH_PREFIXES
    escaped = "|".join(re.escape(p) for p in prefixes)
    return re.compile(rf"^(?:{escaped})/(?:(\d+)(?:-.*)?|[A-Za-z][\w.-]*)$")


def merge_board_fields(core_fields: list[dict], overlay: dict) -> list[dict]:
    merged = json.loads(json.dumps(core_fields))
    if not overlay.get("loaded"):
        return merged

    for field in merged:
        if field.get("name") == "Адресат" and field.get("dataType") == "SINGLE_SELECT":
            opts = field.setdefault("options", [])
            existing_descs = {o.get("description") for o in opts}
            pool_lbl = overlay.get("pool_label", DEFAULT_POOL_LABEL)
            if pool_lbl not in existing_descs:
                opts.append({"name": f"Пул ({pool_lbl})", "color": "GREEN", "description": pool_lbl})
                existing_descs.add(pool_lbl)
            for node in overlay.get("roster", []):
                if node["label"] not in existing_descs:
                    opts.append({
                        "name": node["name"],
                        "color": node["board_color"],
                        "description": node["label"],
                    })
                    existing_descs.add(node["label"])

    existing_names = {f.get("name") for f in merged}
    for cfield in overlay.get("custom_board_fields", []):
        if cfield["name"] not in existing_names:
            merged.append(cfield)
            existing_names.add(cfield["name"])
    return merged


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", type=Path, default=ROOT, help="Корень канона")
    p.add_argument("--project-config", type=Path, help="Явный путь к project.json")
    p.add_argument("--emit-labels-tsv", action="store_true", help="Вывести дополнительные метки ростера в формате name\\tcolor\\tdescription")
    p.add_argument("--check-claim-as", default="", help="Проверить допустимость --claim-as против ростера project.json")
    p.add_argument("--pool-label", action="store_true", help="Вывести активный pool_label проекта (по умолчанию to:pool)")
    p.add_argument("--merge-board-fields-json", default="", help="JSON базовых полей борда для обогащения из project.json")
    args = p.parse_args(argv)

    try:
        overlay = load_overlay(args.root.resolve(), args.project_config)
    except ValueError as exc:
        print(f"project_overlay: {exc}", file=sys.stderr)
        return 2

    if args.check_claim_as:
        err = validate_claim_as(args.check_claim_as, overlay)
        if err:
            print(err, file=sys.stderr)
            return 2
        return 0

    if args.pool_label:
        print(overlay["pool_label"])
        return 0

    if args.emit_labels_tsv:
        for item in overlay_labels(overlay):
            desc = item["description"].replace("\t", " ").replace("\n", " ")
            print(f"{item['name']}\t{item['color']}\t{desc}")
        return 0

    if args.merge_board_fields_json:
        core = json.loads(args.merge_board_fields_json)
        print(json.dumps(merge_board_fields(core, overlay), ensure_ascii=False))
        return 0

    print(json.dumps(overlay, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
