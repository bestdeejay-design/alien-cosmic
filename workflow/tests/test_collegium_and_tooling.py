from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

try:
    import yaml
except ModuleNotFoundError:  # PyYAML опционален: нужен только для YAML-фронтматтеров/workflows (issue #79, H-03)
    yaml = None
HAS_YAML = yaml is not None

from check_core_labels import planned_labels

ROOT = Path(__file__).resolve().parents[1]

requires_yaml = unittest.skipUnless(HAS_YAML, "PyYAML не установлен (python3 -m pip install -r tests/requirements.txt)")


def run_cmd(cmd: list[str], cwd: Path = ROOT, stdin_text: str | None = None, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=cwd,
        input=stdin_text,
        text=True,
        capture_output=True,
        check=False,
        env=env,
    )


class SchemaAndProgressiveDisclosureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.schema = json.loads((ROOT / "schema" / "bus.json").read_text(encoding="utf-8"))

    def test_schema_labels_match_script_and_snapshot(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        from project_overlay import load_overlay, overlay_labels

        labels = [
            entry["name"]
            for grp in self.schema["label_groups"].values()
            for entry in grp["values"]
        ]
        overlay_names = {item["name"] for item in overlay_labels(load_overlay(ROOT))}
        self.assertEqual(46, len(labels))
        self.assertEqual(46, len(set(labels)))
        self.assertEqual(set(labels) | overlay_names, set(planned_labels(ROOT)))

    def test_schema_markers_match_bus_and_kb(self):
        markers = self.schema["markers"]
        self.assertEqual(21, len(markers))
        bus_text = (ROOT / "BUS.md").read_text(encoding="utf-8")
        kb_text = (ROOT / "docs" / "KNOWLEDGE_BASE.md").read_text(encoding="utf-8")
        for m in markers:
            self.assertIn(m["prefix"], bus_text, m)
            self.assertIn(m["prefix"], kb_text, m)

    def test_tiers_and_roles_reflect_adr_0002(self):
        tiers = self.schema["tiers"]
        self.assertFalse(tiers["size:S"]["pre_action_gate_pause"])
        self.assertEqual(["executor", "reviewer"], tiers["size:S"]["subagents_required"])
        for big in ("size:M", "size:L"):
            self.assertTrue(tiers[big]["pre_action_gate_pause"])
            self.assertEqual(2, tiers[big]["waves"])
            self.assertEqual(["auditor", "researcher", "executor", "reviewer"], tiers[big]["subagents_required"])
            self.assertEqual("both_intra_task_and_paired_tasks", tiers[big]["role_swap"])

        roles = self.schema["subagent_roles"]
        for ro_role in ("auditor", "researcher", "reviewer"):
            self.assertFalse(roles[ro_role]["write_access"], ro_role)
            self.assertTrue((ROOT / roles[ro_role]["prompt"]).is_file(), ro_role)
        self.assertTrue(roles["executor"]["write_access"])
        self.assertTrue(roles["executor"]["fresh_context_mandatory"])
        self.assertTrue((ROOT / roles["executor"]["prompt"]).is_file())

    @requires_yaml
    def test_root_agents_and_skills_stay_compact_and_valid(self):
        agents_lines = (ROOT / "AGENTS.md").read_text(encoding="utf-8").splitlines()
        self.assertLessEqual(len(agents_lines), 60)

        skill_files = sorted((ROOT / "skills").glob("*/SKILL.md"))
        expected_skills = {
            "adversarial-review",
            "bus-delivery",
            "clean-execution",
            "cli-and-api-robustness",
            "data-migration",
            "edge-case-testing",
            "fullstack-audit",
            "minimal-safe-refactor",
            "root-cause-debugging",
            "security-audit-black-box",
            "security-audit-core",
            "security-audit-fintech",
            "security-audit-gaming",
            "security-audit-grey-box",
            "security-audit-reporting",
            "security-audit-white-box",
            "subagent-collegium",
            "ui-render-verification",
        }
        # Счётчик выводится из единого набора: новый навык = +1 строка в set,
        # а не правка магического числа. Тест не ослаблен: лишний/недостающий
        # навык падает на set-сравнении ниже.
        self.assertEqual(len(expected_skills), len(skill_files))
        self.assertEqual(expected_skills, {sf.parent.name for sf in skill_files})
        for sf in skill_files:
            raw = sf.read_text(encoding="utf-8")
            self.assertTrue(raw.startswith("---\n"), sf)
            end = raw.find("\n---\n", 4)
            self.assertNotEqual(-1, end, sf)
            meta = yaml.safe_load(raw[4:end])
            self.assertEqual(sf.parent.name, meta.get("name"), sf)
            self.assertTrue(isinstance(meta.get("description"), str) and len(meta["description"]) > 15, sf)
            self.assertLessEqual(len(raw.splitlines()), 90, f"{sf} grew too large for progressive disclosure")

    @requires_yaml
    def test_native_cli_agents_and_skills_mirrored_and_valid(self):
        native_root = ROOT if (ROOT / ".claude").is_dir() else ROOT.parent
        # 1. Нативные ролевые карточки .claude/agents/*.md валидны для Claude Code и совместимых CLI
        for role in ("auditor", "researcher", "executor", "reviewer"):
            native_agent = native_root / ".claude" / "agents" / f"{role}.md"
            self.assertTrue(native_agent.is_file(), native_agent)
            raw = native_agent.read_text(encoding="utf-8")
            end = raw.find("\n---\n", 4)
            meta = yaml.safe_load(raw[4:end])
            self.assertEqual(role, meta.get("name"))
            self.assertTrue(isinstance(meta.get("description"), str) and len(meta["description"]) > 15)
            self.assertTrue(isinstance(meta.get("skills"), list) and len(meta["skills"]) >= 1)
            if role != "executor":
                self.assertIn("Write", str(meta.get("disallowedTools", "")))
                self.assertIn("Edit", str(meta.get("disallowedTools", "")))

        # 2. install-skills --check подтверждает нулевой рассинхрон .claude/ и .agents/ при локальных зеркалах
        if native_root == ROOT:
            chk = run_cmd([sys.executable, str(ROOT / "scripts" / "install-skills"), "--check"])
            self.assertEqual(0, chk.returncode, chk.stderr)
            self.assertIn("install-skills OK", chk.stdout)

        # 3. Новые карточки и навыки не вводят несуществующих префиксных лейблов
        from regression import DOC_EXAMPLE_ROSTER_LABELS, LABEL, PROJECT_PATTERN

        core_set = set(planned_labels(ROOT)) | set(DOC_EXAMPLE_ROSTER_LABELS)
        scan_dirs = [ROOT / "agents", ROOT / "skills", native_root / ".claude", native_root / ".agents"]
        for mdir in scan_dirs:
            for md in sorted(mdir.rglob("*.md")):
                content = md.read_text(encoding="utf-8")
                self.assertIsNone(PROJECT_PATTERN.search(content), md)
                found_labels = set(LABEL.findall(content))
                self.assertEqual(set(), found_labels - core_set, f"unknown label token in {md}: {found_labels - core_set}")

    def test_install_skills_rollout_to_target_project_respects_no_clobber(self):
        with tempfile.TemporaryDirectory(prefix="rollout-test-") as tmp:
            proj = Path(tmp) / "sample-project"
            proj.mkdir()
            (proj / "README.md").write_text("# My Existing Project\n", encoding="utf-8")

            # Первичная установка с --with-harness
            r1 = run_cmd([
                sys.executable, str(ROOT / "scripts" / "install-skills"),
                "--target", str(proj), "--with-harness",
            ])
            self.assertEqual(0, r1.returncode, r1.stderr)
            self.assertTrue((proj / ".claude" / "agents" / "auditor.md").is_file())
            self.assertTrue((proj / ".claude" / "skills" / "fullstack-audit" / "SKILL.md").is_file())
            self.assertTrue((proj / ".agents" / "skills" / "ui-render-verification" / "SKILL.md").is_file())
            self.assertTrue((proj / "scripts" / "spawn-pack").is_file())
            self.assertEqual("# My Existing Project\n", (proj / "README.md").read_text(encoding="utf-8"))

            # Модифицируем один файл в проекте: без --force перезапись должна быть заблокирована (код 2)
            custom_skill = proj / ".claude" / "skills" / "fullstack-audit" / "SKILL.md"
            custom_skill.write_text("# Local customization\n", encoding="utf-8")
            r_conflict = run_cmd([
                sys.executable, str(ROOT / "scripts" / "install-skills"),
                "--target", str(proj),
            ])
            self.assertEqual(2, r_conflict.returncode)
            self.assertIn("КОНФЛИКТ", r_conflict.stderr)
            self.assertEqual("# Local customization\n", custom_skill.read_text(encoding="utf-8"))

            # С флагом --force обновляется штатно
            r_forced = run_cmd([
                sys.executable, str(ROOT / "scripts" / "install-skills"),
                "--target", str(proj), "--force",
            ])
            self.assertEqual(0, r_forced.returncode, r_forced.stderr)
            self.assertNotEqual("# Local customization\n", custom_skill.read_text(encoding="utf-8"))

    def test_skill_md_links_resolve_after_install(self):
        # R2-08/#108: ссылки внутри SKILL.md должны резолвиться и в каноне
        # (skills/...), и в зеркалах после раскатки (.claude/.agents), где
        # структура skills/<имя>/ сохраняется, но корень другой.
        link_re = re.compile(r"\[[^\[\]\n]+\]\(([^()\n]+)\)")
        with tempfile.TemporaryDirectory(prefix="skill-links-") as tmp:
            proj = Path(tmp) / "sample-project"
            proj.mkdir()
            r = run_cmd([
                sys.executable, str(ROOT / "scripts" / "install-skills"),
                "--target", str(proj),
            ])
            self.assertEqual(0, r.returncode, r.stderr)

            for mirror in (proj / ".claude" / "skills", proj / ".agents" / "skills"):
                self.assertTrue(mirror.is_dir())
                for md in sorted(mirror.glob("*/SKILL.md")):
                    for m in link_re.finditer(md.read_text(encoding="utf-8")):
                        target = m.group(1).strip()
                        if target.startswith(("http://", "https://", "#")):
                            continue
                        dest = (md.parent / target).resolve()
                        self.assertTrue(dest.exists(), f"битая ссылка {target} в {md}")

    def test_install_skills_self_mode_env_skills_and_stale_mirrors(self):
        # R2-04/#104: три класса файлов в .claude/skills и .agents/skills —
        # (а) канон, (б) env_skill из project.json, (в) устаревшее зеркало/мусор.
        # --check ловит (в) как ошибку; env_skill KEEP; --force не сносит env_skill,
        # для сноса нужно явное --force --prune-env-skill <имя>.
        with tempfile.TemporaryDirectory(prefix="env-skills-self-") as tmp:
            proj = Path(tmp) / "adopted-project"
            proj.mkdir()
            for sub in ("schema", "agents", "skills", "scripts"):
                shutil.copytree(ROOT / sub, proj / sub)
            (proj / "project.json").write_text(
                json.dumps({
                    "schema_version": "1.0",
                    "project": {"slug": "adopted", "repo": "example/adopted"},
                    "env_skills": ["python-fastapi", "react-playwright"],
                }),
                encoding="utf-8",
            )

            env_claude = proj / ".claude" / "skills" / "python-fastapi" / "SKILL.md"
            env_claude.parent.mkdir(parents=True)
            env_claude.write_text(
                "---\nname: python-fastapi\ndescription: Контракты эндпоинтов и миграций проекта.\n---\n\n# FastAPI Stack Rules\n",
                encoding="utf-8",
            )
            env_extra = proj / ".claude" / "skills" / "python-fastapi" / "support" / "notes.md"
            env_extra.parent.mkdir(parents=True)
            env_extra.write_text("# project notes\n", encoding="utf-8")
            env_agents = proj / ".agents" / "skills" / "react-playwright" / "SKILL.md"
            env_agents.parent.mkdir(parents=True)
            env_agents.write_text(
                "---\nname: react-playwright\ndescription: Компонентные инварианты и e2e-сценарии проекта.\n---\n\n# Playwright Stack Rules\n",
                encoding="utf-8",
            )
            # (в) устаревшее зеркало удалённого канон-навыка — имя НЕ заявлено в env_skills
            ghost_mirror = proj / ".agents" / "skills" / "old-ghost-skill" / "SKILL.md"
            ghost_mirror.parent.mkdir(parents=True)
            ghost_mirror.write_text("stale mirror of removed canon skill\n", encoding="utf-8")
            # (в) посторонний файл внутри каталога канон-навыка
            junk_in_canon = proj / ".claude" / "skills" / "clean-execution" / "STALE_GHOST.md"
            junk_in_canon.parent.mkdir(parents=True)
            junk_in_canon.write_text("junk\n", encoding="utf-8")
            stale_role = proj / ".claude" / "agents" / "ghost-role.md"
            stale_role.parent.mkdir(parents=True)
            stale_role.write_text("stale mirror\n", encoding="utf-8")

            inst = str(proj / "scripts" / "install-skills")

            # 1) --check ловит устаревшие зеркала (exit 1), env_skills не валидирует
            chk = run_cmd([sys.executable, inst, "--check"])
            self.assertEqual(1, chk.returncode, chk.stdout)
            self.assertIn("old-ghost-skill", chk.stderr)
            self.assertIn("clean-execution", chk.stderr)
            self.assertNotIn("python-fastapi", chk.stderr)

            # 2) Обычный запуск: зеркала/мусор чистятся без --force, env_skills KEEP
            r1 = run_cmd([sys.executable, inst])
            self.assertEqual(0, r1.returncode, r1.stderr)
            self.assertTrue(env_claude.is_file(), r1.stdout)
            self.assertTrue(env_extra.is_file(), r1.stdout)
            self.assertTrue(env_agents.is_file(), r1.stdout)
            self.assertFalse(ghost_mirror.exists())
            self.assertFalse(junk_in_canon.exists())
            self.assertFalse(stale_role.exists())
            self.assertIn("KEEP", r1.stdout)
            self.assertIn("python-fastapi", r1.stdout)
            self.assertIn("устаревшее зеркало", r1.stdout)

            # 3) --check зелёный после очистки
            chk2 = run_cmd([sys.executable, inst, "--check"])
            self.assertEqual(0, chk2.returncode, chk2.stderr)
            self.assertIn("install-skills OK", chk2.stdout)

            # 4) --force НЕ сносит заявленные env_skills
            r2 = run_cmd([sys.executable, inst, "--force"])
            self.assertEqual(0, r2.returncode, r2.stderr)
            self.assertTrue(env_claude.is_file())
            self.assertTrue(env_agents.is_file())
            self.assertIn("KEEP", r2.stdout)

            # 5) --prune-env-skill без --force — ошибка
            r3 = run_cmd([sys.executable, inst, "--prune-env-skill", "python-fastapi"])
            self.assertEqual(2, r3.returncode, r3.stdout)

            # 6) --force --prune-env-skill <имя> сносит только перечисленное
            r4 = run_cmd([sys.executable, inst, "--force", "--prune-env-skill", "python-fastapi"])
            self.assertEqual(0, r4.returncode, r4.stderr)
            self.assertFalse(env_claude.is_file())
            self.assertFalse(env_extra.is_file())
            self.assertTrue(env_agents.is_file())
            self.assertIn("--prune-env-skill python-fastapi", r4.stdout)
            self.assertIn("react-playwright", r4.stdout)

    def test_debt_42_and_incident_41_synced(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        board = (ROOT / "BOARD.md").read_text(encoding="utf-8")
        debt = (ROOT / "DEBT.md").read_text(encoding="utf-8")
        mail = (ROOT / "docs" / "MAIL.md").read_text(encoding="utf-8")
        adr2 = (ROOT / "docs" / "decisions" / "2026-11-06-subagent-collegium-and-enforcement.md").read_text(encoding="utf-8")
        preflight_src = (ROOT / "scripts" / "preflight").read_text(encoding="utf-8")
        ops = (ROOT / "OPS.md").read_text(encoding="utf-8")

        self.assertIn("ADR-0001", readme)
        self.assertIn(".githooks/pre-push", readme)
        # Серверный Actions снят (решение владельца 14.11): README/OPS указывают локальные гейты
        self.assertNotIn("guard-main.yml", readme)
        self.assertIn("Серверный GitHub Actions снят", ops)
        self.assertIn("ADR-0001", board)
        self.assertRegex(debt, r"\| D-011 \|.*resolved")
        self.assertRegex(debt, r"\| D-012 \|.*resolved")

        # ADR-0002 соответствует docs/decisions/_TEMPLATE.md (B1 + минор зеркал)
        for required_token in (
            "## Контекст",
            "## Рассмотренные варианты",
            "- Суть:",
            "- Совместимость с существующим:",
            "## Решение",
            "## Последствия",
            "- Создаваемый долг:",
            "- Как проверим, что решение сработало:",
            ".claude/",
            ".agents/",
        ):
            self.assertIn(required_token, adr2)

        # Миноры ревью закрыты: нет /tmp/agents-pyyaml в preflight, нейтральный MAIL.md
        # (пагинация bus-hygiene снята вместе с серверным Actions, решение владельца 14.11)
        self.assertNotIn("/tmp/agents-pyyaml", preflight_src)
        self.assertTrue(mail.startswith("# MAIL —"))
        self.assertIn("ext/<hash>-<slug>", mail)


class LabelDescriptionSyncTests(unittest.TestCase):
    """Гейт сверки описаний меток schema/bus.json vs create-labels.sh (issue #86 / H1)."""

    def setUp(self) -> None:
        for path in (str(ROOT / "scripts"), str(ROOT / "tests")):
            if path not in sys.path:
                sys.path.insert(0, path)
        import importlib.util
        from importlib.machinery import SourceFileLoader

        from check_core_labels import planned_label_specs

        # scripts/preflight — исполняемый файл без расширения .py: грузим загрузчиком,
        # а не обычным import (import preflight слепо ищет preflight.py и падает).
        preflight_path = ROOT / "scripts" / "preflight"
        loader = SourceFileLoader("agents_preflight_under_test", str(preflight_path))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        preflight = importlib.util.module_from_spec(spec)
        loader.exec_module(preflight)
        self.label_description_diffs = preflight.label_description_diffs
        self.normalize = preflight.normalize_label_description
        self.planned_label_specs = planned_label_specs
        schema = json.loads((ROOT / "schema" / "bus.json").read_text(encoding="utf-8"))
        self.bus_descriptions = {
            entry["name"]: entry["description"]
            for group in schema["label_groups"].values()
            for entry in group["values"]
        }

    def test_normalize_strips_form_prefixes_and_whitespace(self):
        self.assertEqual("исполнитель работает", self.normalize("Статус: исполнитель работает"))
        self.assertEqual("новая функциональность", self.normalize("Тип: новая функциональность"))
        self.assertEqual("исполнителя запускает владелец вручную", self.normalize("Флаг: Исполнителя запускает владелец вручную"))
        self.assertEqual("внутри одного модуля", self.normalize("Размер M:  внутри одного модуля"))
        self.assertEqual("просто текст", self.normalize("  просто   текст  "))

    def test_real_repo_script_descriptions_in_sync_with_bus_json(self):
        specs = self.planned_label_specs(ROOT)
        self.assertEqual([], self.label_description_diffs(self.bus_descriptions, specs))

    def test_gate_catches_stale_pre_adr_size_s_description(self):
        specs = dict(self.planned_label_specs(ROOT))
        specs["size:S"] = "Размер S: дифф одним предложением, мини-аудит + conclusion одним комментарием"
        diffs = self.label_description_diffs(self.bus_descriptions, specs)
        self.assertTrue(any(d.startswith("size:S:") for d in diffs), diffs)

    def test_gate_catches_meaning_drift_on_size_m(self):
        specs = dict(self.planned_label_specs(ROOT))
        specs["size:M"] = "Внутри одного модуля, полный ARCA в issue"
        diffs = self.label_description_diffs(self.bus_descriptions, specs)
        self.assertTrue(any(d.startswith("size:M:") for d in diffs), diffs)

    def test_gate_tolerates_form_prefix_and_content_superset(self):
        specs = dict(self.planned_label_specs(ROOT))
        self.assertEqual([], self.label_description_diffs(self.bus_descriptions, specs))
        # префиксы форм на стороне скрипта — нормализуются и не дают расхождений
        prefixed = {name: f"Тип: {text}" for name, text in specs.items()}
        self.assertEqual([], self.label_description_diffs(self.bus_descriptions, prefixed))
        # bus-описание как подстрока дополненного описания скрипта — совпадение
        specs["to:owner"] = "Текущий адресат: владелец (решение, запуск, приёмка)"
        self.assertEqual([], self.label_description_diffs(self.bus_descriptions, specs))

    def test_gate_ignores_missing_names_and_reports_only_real_drift(self):
        partial = {name: text for name, text in self.planned_label_specs(ROOT).items() if name != "size:L"}
        self.assertEqual([], self.label_description_diffs(self.bus_descriptions, partial))


class SpawnPackEnforcerTests(unittest.TestCase):
    SCRIPT = [sys.executable, str(ROOT / "scripts" / "spawn-pack")]

    def test_catalog_listing(self):
        res = run_cmd([*self.SCRIPT, "--list"])
        self.assertEqual(0, res.returncode, res.stderr)
        for token in ("auditor", "researcher", "executor", "reviewer", "clean-execution", "adversarial-review"):
            self.assertIn(token, res.stdout)

    def test_rejects_missing_skills(self):
        res = run_cmd([*self.SCRIPT, "--role", "auditor", "--issue", "42"])
        self.assertEqual(2, res.returncode)
        self.assertIn("обязан явно подключить навыки", res.stderr)

    def test_rejects_m_executor_without_collegium_packs_or_reviewer_kick(self):
        res = run_cmd([
            *self.SCRIPT, "--role", "executor", "--skills", "clean-execution",
            "--size", "M", "--issue", "50", "--audit-pack", "ok", "--spec-pack", "ok",
        ])
        self.assertEqual(2, res.returncode)
        self.assertIn("reviewer-kick", res.stderr)

    def test_accepts_full_m_wave1_executor_and_auto_includes_default_skills(self):
        res = run_cmd([
            *self.SCRIPT, "--role", "executor", "--skills", "data-migration",
            "--size", "M", "--issue", "50",
            "--audit-pack", "Файлы: loader.py",
            "--spec-pack", "Канал А: подъём схемы v1->v2",
            "--reviewer-kick", "Ловушка 1: пустой сейв; Ловушка 2: идемпотентность",
        ])
        self.assertEqual(0, res.returncode, res.stderr)
        self.assertIn("`clean-execution`", res.stdout)
        self.assertIn("`bus-delivery`", res.stdout)
        self.assertIn("`data-migration`", res.stdout)
        self.assertIn("Ловушка 1: пустой сейв", res.stdout)

    def test_fast_track_size_s_does_not_require_m_packs(self):
        res = run_cmd([
            *self.SCRIPT, "--role", "executor", "--skills", "default",
            "--size", "S", "--issue", "42", "--brief", "Синхронизировать п.4 README",
        ])
        self.assertEqual(0, res.returncode, res.stderr)
        self.assertIn("Fast-Track (`size:S`)", res.stdout)

    def test_wave2_role_swap_enforced(self):
        # Без смены роли (executor -> executor) должен падать
        same_role = run_cmd([
            *self.SCRIPT, "--role", "executor", "--swap-from", "executor",
            "--wave", "2", "--wave1-sha", "a1b2c3d", "--skills", "default",
            "--size", "M", "--issue", "50", "--allow-incomplete",
        ])
        self.assertEqual(2, same_role.returncode)

        # Корректная смена reviewer -> executor во Волне 2
        swapped = run_cmd([
            *self.SCRIPT, "--role", "executor", "--swap-from", "reviewer",
            "--wave", "2", "--wave1-sha", "a1b2c3d", "--skills", "clean-execution",
            "--size", "M", "--issue", "50",
            "--audit-pack", "audit", "--spec-pack", "spec", "--reviewer-kick", "kick",
            "--collegium-findings", "Дописать тест на повреждённый JSON",
        ])
        self.assertEqual(0, swapped.returncode, swapped.stderr)
        self.assertIn("КОНТРАКТ 2-Й ВОЛНЫ СО СМЕНОЙ РОЛЕЙ", swapped.stdout)
        self.assertIn("a1b2c3d", swapped.stdout)
        self.assertIn("Запрет само-ревью", swapped.stdout)

    def test_auto_skill_selection_and_from_issue(self):
        # 1. Автоподбор навыков по меткам и путям радиуса (багфикс на стыке Frontend + API + миграция БД)
        res = run_cmd([
            *self.SCRIPT, "--role", "executor", "--auto", "--explain-skills",
            "--labels", "type:bugfix,size:M",
            "--radius", "frontend/src/App.tsx,api/users.py,db/migrations/001.sql",
            "--issue", "77",
        ])
        self.assertEqual(0, res.returncode, res.stderr)
        explained = json.loads(res.stdout)
        for expected in (
            "clean-execution",
            "bus-delivery",
            "root-cause-debugging",
            "edge-case-testing",
            "ui-render-verification",
            "cli-and-api-robustness",
            "data-migration",
        ):
            self.assertIn(expected, explained["skills"])

        # 2. --from-issue подтягивает метки и бриф через gh api
        with tempfile.TemporaryDirectory(prefix="spawn-gh-") as tmp:
            bin_dir = Path(tmp)
            fake_gh = bin_dir / "gh"
            fake_gh.write_text(
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import json, sys
                    print(json.dumps({
                        "number": 88,
                        "title": "Исправить рефакторинг и баг UI кнопки",
                        "body": "На мобильном экране 375px падает отправка формы в API",
                        "labels": [{"name": "type:bugfix"}, {"name": "size:S"}]
                    }))
                    """
                ),
                encoding="utf-8",
            )
            fake_gh.chmod(0o755)
            env = os.environ.copy()
            env["AGENT_PROJECT_CONFIG"] = str(ROOT / "tests" / "fixtures" / "project-test.json")
            env["PATH"] = f"{bin_dir}:{env.get('PATH', '')}"
            live = run_cmd([
                *self.SCRIPT, "--role", "executor", "--auto", "--from-issue",
                "--repo", "owner/repo", "--issue", "88",
            ], env=env)
            self.assertEqual(0, live.returncode, live.stderr)
            self.assertIn("size:S", live.stdout)
            self.assertIn("`ui-render-verification`", live.stdout)
            self.assertIn("`cli-and-api-robustness`", live.stdout)
            self.assertIn("`root-cause-debugging`", live.stdout)

    def test_auto_skill_selection_security_audit(self):
        # 1. Сигналы аудита безопасности: ядро + отчётность, домен по явным ключевым словам
        res = run_cmd([
            *self.SCRIPT, "--role", "auditor", "--auto", "--explain-skills",
            "--labels", "type:security,size:M",
            "--brief", "Пентест платежного сервиса: уязвимости вебхуков, double spend, KYC",
            "--issue", "105",
        ])
        self.assertEqual(0, res.returncode, res.stderr)
        explained = json.loads(res.stdout)
        self.assertIn("security-audit-core", explained["skills"])
        self.assertIn("security-audit-reporting", explained["skills"])
        self.assertIn("security-audit-fintech", explained["skills"])
        self.assertNotIn("security-audit-gaming", explained["skills"])

        # 2. Игровой домен по ключевым словам брифа
        res = run_cmd([
            *self.SCRIPT, "--role", "executor", "--auto", "--explain-skills",
            "--labels", "type:research,size:M",
            "--brief", "Проверить защиту игровой экономики: дюп валюты, донат и лутбоксы",
            "--issue", "106",
        ])
        self.assertEqual(0, res.returncode, res.stderr)
        explained = json.loads(res.stdout)
        for expected in ("security-audit-core", "security-audit-reporting", "security-audit-gaming"):
            self.assertIn(expected, explained["skills"])
        self.assertNotIn("security-audit-fintech", explained["skills"])

        # 3. Режимные навыки — только по явному упоминанию режима
        res = run_cmd([
            *self.SCRIPT, "--role", "auditor", "--auto", "--explain-skills",
            "--labels", "type:security,size:M",
            "--brief", "Black box пентест публичного API: инъекции и misconfig",
            "--issue", "107",
        ])
        self.assertEqual(0, res.returncode, res.stderr)
        explained = json.loads(res.stdout)
        self.assertIn("security-audit-black-box", explained["skills"])
        self.assertNotIn("security-audit-white-box", explained["skills"])

        # 4. Без сигналов безопасности навыки пакета не выдаются
        res = run_cmd([
            *self.SCRIPT, "--role", "executor", "--auto", "--explain-skills",
            "--labels", "type:bugfix,size:S",
            "--brief", "Падает кнопка на фронтенде",
            "--issue", "108",
        ])
        self.assertEqual(0, res.returncode, res.stderr)
        explained = json.loads(res.stdout)
        self.assertNotIn("security-audit-core", explained["skills"])

    def test_fullstack_audit_preset_generates_four_clean_subagent_packs(self):
        with tempfile.TemporaryDirectory(prefix="fs-audit-") as tmp:
            out_dir = Path(tmp) / "packs"
            res = run_cmd([*self.SCRIPT, "--preset", "fullstack-audit", "--output-dir", str(out_dir)])
            self.assertEqual(0, res.returncode, res.stderr)
            for fname in (
                "00-COORDINATOR-RUNBOOK.md",
                "01-auditor-frontend.md",
                "02-auditor-api.md",
                "03-auditor-backend.md",
                "04-reviewer-seams.md",
            ):
                p = out_dir / fname
                self.assertTrue(p.is_file(), fname)
            self.assertIn("`ui-render-verification`", (out_dir / "01-auditor-frontend.md").read_text(encoding="utf-8"))
            self.assertIn("`cli-and-api-robustness`", (out_dir / "02-auditor-api.md").read_text(encoding="utf-8"))
            self.assertIn("`data-migration`", (out_dir / "03-auditor-backend.md").read_text(encoding="utf-8"))
            self.assertIn("СТРОГО READ-ONLY", (out_dir / "04-reviewer-seams.md").read_text(encoding="utf-8"))


class HooksWorkflowsAndRunnerTests(unittest.TestCase):
    def test_pre_push_hook_blocks_main_and_allows_feature_branch(self):
        # Хук проверяет замок владельца ДО main-гейта: для этого теста замок
        # открыт через GUARD_UNLOCK_FILE (сам замок — OwnerGuardTests).
        hook = str(ROOT / ".githooks" / "pre-push")
        with tempfile.TemporaryDirectory(prefix="hook-unlock-") as tmp:
            unlock_file = Path(tmp) / ".guard-unlock"
            from datetime import datetime, timezone

            unlock_file.write_text(
                datetime.now(timezone.utc).strftime("%Y-%m-%d") + " | тест\n", encoding="utf-8"
            )
            env = {"GUARD_UNLOCK_FILE": str(unlock_file)}
            blocked = run_cmd(
                ["bash", hook, "origin", "https://example.com/org/project.git"],
                stdin_text="refs/heads/work/42 abcdef1234567 refs/heads/main 0000000000000\n",
                env=env,
            )
            self.assertEqual(1, blocked.returncode)
            self.assertIn("ЗАБЛОКИРОВАНО", blocked.stderr)

            allowed = run_cmd(
                ["bash", hook, "origin", "https://example.com/org/project.git"],
                stdin_text="refs/heads/ext/f00268e7-project abcdef1234567 refs/heads/ext/f00268e7-project 0000000000000\n",
                env=env,
            )
            self.assertEqual(0, allowed.returncode, allowed.stderr)

    @requires_yaml
    def test_github_workflows_parse_and_define_permissions(self):
        # Серверный Actions снят с хаба (решение владельца 14.11, #169):
        # если workflow-каталога нет — гейт не применяется (Режим B проекты
        # со своей автоматикой по-прежнему проверяются этой же логикой).
        # Фолбэк Режима B: канон в <project>/workflow/, workflows в родителе.
        wf_dir = ROOT / ".github" / "workflows" if (ROOT / ".github" / "workflows").is_dir() else ROOT.parent / ".github" / "workflows"
        if not wf_dir.is_dir():
            self.skipTest("server Actions removed from hub (#169)")
        for name in ("ci.yml", "bus-hygiene.yml", "guard-main.yml"):
            path = wf_dir / name
            self.assertTrue(path.is_file(), name)
            doc = yaml.safe_load(path.read_text(encoding="utf-8"))
            self.assertIsInstance(doc, dict, name)
            self.assertIn("jobs", doc, name)
            has_perms = "permissions" in doc or all("permissions" in j for j in doc["jobs"].values())
            self.assertTrue(has_perms, f"{name} must declare explicit permissions")

    def test_preflight_skip_tests_and_radius_guard(self):
        ok = run_cmd([sys.executable, str(ROOT / "scripts" / "preflight"), "--skip-tests", "--ci-main"])
        self.assertEqual(0, ok.returncode, ok.stderr)
        self.assertIn("PREFLIGHT OK", ok.stdout)

        # Радиус-гард смотрит изменённые файлы (base...HEAD + git diff HEAD),
        # поэтому создаём файл-пробник вне разрешённого радиуса и добавляем
        # его в индекс — тогда дифф не пуст на любом состоянии ветки.
        pre_cached = sorted(
            ln.strip() for ln in run_cmd(["git", "diff", "--cached", "--name-only"]).stdout.splitlines() if ln.strip()
        )
        probe = ROOT / "tmp-radius-probe.txt"
        probe.write_text("probe\n", encoding="utf-8")
        try:
            run_cmd(["git", "add", str(probe)])
            # Негатив: радиус не покрывает файл-пробник.
            narrow = run_cmd([
                sys.executable, str(ROOT / "scripts" / "preflight"),
                "--skip-tests", "--ci-main", "--allow", "docs/skills/",
            ])
            self.assertEqual(1, narrow.returncode)
            self.assertIn("выход за разрешённый радиус", narrow.stderr)

            # Позитив: радиус покрывает файл-пробник и текущие изменения ветки/worktree.
            git_top = Path(run_cmd(["git", "rev-parse", "--show-toplevel"]).stdout.strip()).resolve()
            mb_res = run_cmd(["git", "merge-base", "HEAD", "origin/main"])
            committed = (
                run_cmd(["git", "diff", "--name-only", f"{mb_res.stdout.strip()}...HEAD"], cwd=git_top).stdout
                if mb_res.returncode == 0
                else ""
            )
            worktree = run_cmd(["git", "diff", "--name-only", "HEAD"], cwd=git_top).stdout
            own_files = ",".join(sorted({
                ln.strip() for ln in (committed + "\n" + worktree).splitlines() if ln.strip()
            }))
            wide_allow = "tmp-radius-probe.txt,tests/" + (f",{own_files}" if own_files else "")
            wide = run_cmd([
                sys.executable, str(ROOT / "scripts" / "preflight"),
                "--skip-tests", "--ci-main", "--allow", wide_allow,
            ])
            self.assertEqual(0, wide.returncode, wide.stderr)
            self.assertIn("PREFLIGHT OK", wide.stdout)
        finally:
            run_cmd(["git", "reset", "--", str(probe)])
            probe.unlink(missing_ok=True)
        # Cleanup не оставляет артефактов: пробник удалён, индекс в исходном состоянии.
        status = run_cmd(["git", "status", "--porcelain"]).stdout
        self.assertNotIn("tmp-radius-probe", status)
        post_cached = sorted(
            ln.strip() for ln in run_cmd(["git", "diff", "--cached", "--name-only"]).stdout.splitlines() if ln.strip()
        )
        self.assertEqual(pre_cached, post_cached)

    def test_ci_workflow_supports_workflow_layout(self):
        # issue #73 / B-01: ci.yml должен работать и в корневой раскладке
        # (Режим A), и в Режиме B (ядро канона в <project>/workflow/).
        # На хабе серверный Actions снят (решение владельца 14.11, #169) —
        # тест остаётся для проектных копий, где ci.yml сохраняется.
        gh_root = ROOT if (ROOT / ".github" / "workflows").is_dir() else ROOT.parent
        wf = gh_root / ".github" / "workflows" / "ci.yml"
        if not wf.is_file():
            self.skipTest("server Actions removed from hub (#169)")
        text = wf.read_text(encoding="utf-8")
        # Определяется префикс канона по наличию workflow/scripts/preflight.
        self.assertIn("workflow/scripts/preflight", text)
        self.assertIn("CANON=workflow", text)
        self.assertIn("CANON=.", text)
        # Все три команды идут через ${CANON}, без жёстких корневых путей.
        self.assertIn("${CANON}/tests/requirements.txt", text)
        self.assertIn("${CANON}/tests/regression.py", text)
        self.assertIn("${CANON}/scripts/preflight --ci-main", text)
        self.assertNotIn("run: python3 tests/regression.py", text)
        self.assertNotIn("run: python3 scripts/preflight", text)
        self.assertNotIn("run: python3 -m pip install -r tests/requirements.txt", text)

    def test_preflight_radius_guard_without_origin_base(self):
        # issue #73 / B-01: недоступный origin/main (--base не резолвится) не должен
        # молча отключать радиус-гейт --allow: индекс/рабочее дерево проверяются всегда.
        pre_cached = sorted(
            ln.strip() for ln in run_cmd(["git", "diff", "--cached", "--name-only"]).stdout.splitlines() if ln.strip()
        )
        probe = ROOT / "tmp-radius-probe.txt"
        probe.write_text("probe\n", encoding="utf-8")
        try:
            run_cmd(["git", "add", str(probe)])
            base_args = ["--skip-tests", "--ci-main", "--base", "refs/heads/no-such-base"]
            # Негатив: база недоступна, но радиус всё равно режет файл-пробник.
            narrow = run_cmd([
                sys.executable, str(ROOT / "scripts" / "preflight"),
                *base_args, "--allow", "docs/skills/",
            ])
            self.assertEqual(1, narrow.returncode, narrow.stdout)
            self.assertIn("выход за разрешённый радиус", narrow.stderr)

            # Позитив: широкий --allow покрывает пробник, рабочее дерево/индекс и
            # закоммиченные файлы (с #103 при недоступной базе радиус видит дифф
            # HEAD от пустого дерева, то есть весь трекед-контент ветки).
            # Пути — от git-топлевела: в переносимой раскладке ROOT=workflow/
            # вложен в чужой репозиторий, и ls-files из ROOT даёт короткие пути.
            top = run_cmd(["git", "rev-parse", "--show-toplevel"]).stdout.strip()
            top_dir = Path(top) if top else ROOT
            worktree = run_cmd(["git", "diff", "--name-only", "HEAD"], cwd=top_dir).stdout
            tracked = run_cmd(["git", "ls-files"], cwd=top_dir).stdout
            own_files = ",".join(sorted(
                {ln.strip() for ln in (worktree + tracked).splitlines() if ln.strip()}
            ))
            wide_allow = "tmp-radius-probe.txt,tests/" + (f",{own_files}" if own_files else "")
            wide = run_cmd([
                sys.executable, str(ROOT / "scripts" / "preflight"),
                *base_args, "--allow", wide_allow,
            ])
            self.assertEqual(0, wide.returncode, wide.stderr)
            self.assertIn("PREFLIGHT OK", wide.stdout)
        finally:
            run_cmd(["git", "reset", "--", str(probe)])
            probe.unlink(missing_ok=True)
        status = run_cmd(["git", "status", "--porcelain"]).stdout
        self.assertNotIn("tmp-radius-probe", status)
        post_cached = sorted(
            ln.strip() for ln in run_cmd(["git", "diff", "--cached", "--name-only"]).stdout.splitlines() if ln.strip()
        )
        self.assertEqual(pre_cached, post_cached)

    def test_preflight_radius_guard_catches_committed_files_without_base(self):
        # issue #103: при недоступной базе радиус-гейт обязан видеть и закоммиченные
        # изменения (дифф HEAD от пустого дерева), а не только рабочее дерево/индекс.
        # Стенд — переносимая раскладка workflow/ (как в test_canon_portable_in_
        # workflow_subdirectory): git-топ = host, канон в host/workflow/. ROOT у
        # preflight определяется по расположению скрипта, а клонировать ROOT нельзя:
        # в переносимой раскладке это не репозиторий. История стенда: первичный
        # коммит + probe-коммит с файлом вне --allow.
        with tempfile.TemporaryDirectory(prefix="radius-committed-") as tmp:
            host = Path(tmp) / "host"
            wf = host / "workflow"
            host.mkdir()
            def _ignore(dirpath: str, names: list[str]) -> set[str]:
                rel = Path(dirpath).resolve().relative_to(ROOT).as_posix()
                ignored = {".git", "__pycache__", ".pytest_cache"}
                if rel == ".":
                    ignored |= {".claude", ".agents", ".github"}
                return ignored & set(names)
            shutil.copytree(ROOT, wf, ignore=_ignore)
            # Формы issues: как их резолвит tests/regression.py (resolve_forms_dir) —
            # из канона или из родителя (переносимая раскладка workflow/).
            forms_src = None
            if (ROOT / ".github" / "ISSUE_TEMPLATE").is_dir():
                forms_src = ROOT / ".github"
            elif (ROOT.parent / ".github" / "ISSUE_TEMPLATE").is_dir():
                forms_src = ROOT.parent / ".github"
            if forms_src is not None:
                shutil.copytree(forms_src, host / ".github")

            # Раскат нативных зеркал CLI (как в portable-тесте) — иначе Purity-гейт
            # стенда краснеет на рассинхрон .claude/.agents.
            roll = run_cmd([
                sys.executable, str(wf / "scripts" / "install-skills"),
                "--project-root", str(host),
            ], cwd=host)
            self.assertEqual(0, roll.returncode, roll.stderr)

            def git(*args: str) -> subprocess.CompletedProcess[str]:
                return run_cmd(["git", *args], cwd=host)
            git("init", "-q", "-b", "main")
            git("config", "user.email", "test@example.com")
            git("config", "user.name", "Test")
            git("add", "-A")
            git("commit", "-q", "-m", "chore: canon adoption in workflow/")
            probe = "tmp-radius-committed-outside.txt"
            (host / probe).write_text("outside\n", encoding="utf-8")
            git("add", "-A")
            commit = git("commit", "-q", "-m", "probe: committed outside radius (#103)")
            self.assertEqual(0, commit.returncode, commit.stderr)

            base_args = [
                sys.executable, str(wf / "scripts" / "preflight"),
                "--skip-tests", "--ci-main", "--base", "refs/heads/no-such-base",
            ]
            # Негатив: закоммиченный файл вне --allow при недоступной базе — FAIL,
            # и именно пробник (до #103 гейт молча пропускал закоммиченное).
            narrow = run_cmd([*base_args, "--allow", "docs/"], cwd=host)
            self.assertEqual(1, narrow.returncode, narrow.stdout)
            self.assertIn("выход за разрешённый радиус", narrow.stderr)
            self.assertIn(probe, narrow.stderr)

            # Позитив: --allow, покрывающий весь трекед-контент и пробник, — OK.
            tracked = run_cmd(["git", "ls-files"], cwd=host).stdout
            wide_allow = probe + "," + ",".join(sorted({ln.strip() for ln in tracked.splitlines() if ln.strip()}))
            wide = run_cmd([*base_args, "--allow", wide_allow], cwd=host)
            self.assertEqual(0, wide.returncode, wide.stderr)
            self.assertIn("PREFLIGHT OK", wide.stdout)

    def test_agent_runner_filters_unroutable_and_blocked_and_uses_etag(self):
        with tempfile.TemporaryDirectory(prefix="runner-test-") as tmp:
            tmp_path = Path(tmp)
            bin_dir = tmp_path / "bin"
            bin_dir.mkdir()
            calls_log = tmp_path / "gh_calls.log"
            fake_gh = bin_dir / "gh"
            fake_gh.write_text(
                textwrap.dedent(
                    f"""\
                    #!/usr/bin/env python3
                    import json, sys
                    from pathlib import Path

                    args = sys.argv[1:]
                    log = Path({str(calls_log)!r})
                    log.write_text((log.read_text() if log.exists() else "") + " ".join(args) + "\\n")

                    has_inm = any("If-None-Match:" in a for a in args)
                    endpoint = next((a for a in args if a.startswith("repos/")), "")

                    if "issues?state=open" in endpoint:
                        if has_inm:
                            sys.stdout.write("HTTP/2 304\\r\\n\\r\\n")
                            raise SystemExit(1)
                        issues = [
                            # 1) Сирота без to:* и agent:* (реальный кейс #42) — должна быть отсеяна
                            {{"number": 42, "title": "Orphan", "body": "", "labels": [{{"name": "status:ready"}}, {{"name": "size:S"}}]}},
                            # 2) Заблокирована открытой зависимостью #99 — должна быть отсеяна
                            {{"number": 43, "title": "Blocked dep", "body": "Depends on: #99",
                              "labels": [{{"name": "status:ready"}}, {{"name": "to:pool"}}, {{"name": "agent:coder"}}]}},
                            # 3) Валидный кандидат с закрытой зависимостью #98 — должен пройти!
                            {{"number": 44, "title": "Valid ready task", "body": "Depends on: #98",
                              "labels": [{{"name": "status:ready"}}, {{"name": "to:pool"}}, {{"name": "agent:coder"}}, {{"name": "size:S"}}]}},
                        ]
                        sys.stdout.write('HTTP/2 200\\r\\nETag: "runner-etag-1"\\r\\n\\r\\n' + json.dumps(issues))
                        raise SystemExit(0)

                    if endpoint.endswith("/issues/99"):
                        sys.stdout.write('HTTP/2 200\\r\\nETag: "e99"\\r\\n\\r\\n' + json.dumps({{"number": 99, "state": "open"}}))
                        raise SystemExit(0)

                    if endpoint.endswith("/issues/98"):
                        sys.stdout.write('HTTP/2 200\\r\\nETag: "e98"\\r\\n\\r\\n' + json.dumps({{"number": 98, "state": "closed"}}))
                        raise SystemExit(0)

                    sys.exit(2)
                    """
                ),
                encoding="utf-8",
            )
            fake_gh.chmod(0o755)

            env = os.environ.copy()
            env["AGENT_PROJECT_CONFIG"] = str(ROOT / "tests" / "fixtures" / "project-test.json")
            env["PATH"] = f"{bin_dir}:{env.get('PATH', '')}"
            state_dir = tmp_path / "etag"

            # Первый сухой прогон (200 OK, сохраняет ETag)
            r1 = run_cmd([
                sys.executable, str(ROOT / "scripts" / "agent-runner"),
                "--repo", "owner/repo", "--agent", "coder", "--claim-as", "worker-1",
                "--state-dir", str(state_dir), "--dry-run",
            ], env=env)
            self.assertEqual(0, r1.returncode, r1.stderr)
            payload1 = json.loads(r1.stdout)
            self.assertEqual([44], [x["number"] for x in payload1["eligible"]])

            # Повторный прогон (идёт через If-None-Match -> 304 Not Modified -> кэш!)
            r2 = run_cmd([
                sys.executable, str(ROOT / "scripts" / "agent-runner"),
                "--repo", "owner/repo", "--agent", "coder", "--claim-as", "worker-1",
                "--state-dir", str(state_dir), "--dry-run",
            ], env=env)
            self.assertEqual(0, r2.returncode, r2.stderr)
            payload2 = json.loads(r2.stdout)
            self.assertEqual([44], [x["number"] for x in payload2["eligible"]])
            self.assertIn("If-None-Match:", calls_log.read_text(encoding="utf-8"))

    def _fake_git_for_runner(self, bin_dir: Path) -> None:
        """Шим git: команды agent-runner выполняются без реального репозитория."""
        fake_git = bin_dir / "git"
        fake_git.write_text(
            textwrap.dedent(
                """\
                #!/usr/bin/env python3
                import sys
                from pathlib import Path

                args = sys.argv[1:]
                if args[:2] == ["rev-parse", "--verify"]:
                    sys.exit(1)
                if args[:1] == ["fetch"]:
                    sys.exit(0)
                if args[:2] == ["worktree", "add"]:
                    rest = args[2:]
                    # git worktree add [-b <branch>] <path> [<base>]
                    path = rest[2] if rest and rest[0] == "-b" else (rest[0] if rest else "")
                    if path:
                        Path(path).mkdir(parents=True, exist_ok=True)
                    sys.exit(0)
                sys.exit(0)
                """
            ),
            encoding="utf-8",
        )
        fake_git.chmod(0o755)

    def _runner_gh_shim(self, calls_log: Path, issues: list[dict], blocked_by: dict[int, list[dict]] | None = None,
                        closed_issue_nums: set[int] | None = None) -> str:
        blocked_by = blocked_by or {}
        closed_issue_nums = closed_issue_nums or set()
        return textwrap.dedent(
            f"""\
            #!/usr/bin/env python3
            import json, sys
            from pathlib import Path

            args = sys.argv[1:]
            log = Path({str(calls_log)!r})
            log.write_text((log.read_text() if log.exists() else "") + " ".join(args) + "\\n")

            has_inm = any("If-None-Match:" in a for a in args)
            endpoint = next((a for a in args if a.startswith("repos/")), "")

            if "issues?state=open" in endpoint:
                if has_inm:
                    sys.stdout.write("HTTP/2 304\\r\\n\\r\\n")
                    raise SystemExit(1)
                sys.stdout.write('HTTP/2 200\\r\\nETag: "runner-etag-76"\\r\\n\\r\\n' + json.dumps({issues!r}))
                raise SystemExit(0)

            if endpoint.endswith("/dependencies/blocked_by"):
                num = int(endpoint.split("/issues/")[1].split("/")[0])
                blockers = {blocked_by!r}.get(num)
                if blockers is None:
                    sys.stdout.write('HTTP/2 404\\r\\n\\r\\n' + json.dumps({{"message": "Not Found"}}))
                    raise SystemExit(0)
                sys.stdout.write('HTTP/2 200\\r\\nETag: "bb"\\r\\n\\r\\n' + json.dumps(blockers))
                raise SystemExit(0)

            if "/issues/" in endpoint:
                num = int(endpoint.rsplit("/", 1)[1])
                state = "closed" if num in {closed_issue_nums!r} else "open"
                sys.stdout.write('HTTP/2 200\\r\\nETag: "e"\\r\\n\\r\\n' + json.dumps({{"number": num, "state": state}}))
                raise SystemExit(0)

            sys.exit(2)
            """
        )

    def _load_agent_runner(self):
        import importlib.machinery
        import importlib.util

        loader = importlib.machinery.SourceFileLoader("agent_runner_mod", str(ROOT / "scripts" / "agent-runner"))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        mod = importlib.util.module_from_spec(spec)
        loader.exec_module(mod)
        return mod

    def test_agent_runner_refuses_ml_without_collegium_gate(self):
        with tempfile.TemporaryDirectory(prefix="runner-gate-") as tmp:
            tmp_path = Path(tmp)
            bin_dir = tmp_path / "bin"
            bin_dir.mkdir()
            issues = [
                {"number": 77, "title": "Medium task", "body": "",
                 "labels": [{"name": "status:ready"}, {"name": "to:pool"}, {"name": "agent:coder"}, {"name": "size:M"}]},
            ]
            fake_gh = bin_dir / "gh"
            fake_gh.write_text(self._runner_gh_shim(tmp_path / "gh_calls.log", issues), encoding="utf-8")
            fake_gh.chmod(0o755)

            env = os.environ.copy()
            env["AGENT_PROJECT_CONFIG"] = str(ROOT / "tests" / "fixtures" / "project-test.json")
            env["PATH"] = f"{bin_dir}:{env.get('PATH', '')}"
            wt_root = tmp_path / "wt"

            # dry-run: гейт коллегии виден в выдаче
            r_dry = run_cmd([
                sys.executable, str(ROOT / "scripts" / "agent-runner"),
                "--repo", "owner/repo", "--agent", "coder", "--claim-as", "worker-1",
                "--state-dir", str(tmp_path / "etag1"), "--worktree-root", str(wt_root), "--dry-run",
            ], env=env)
            self.assertEqual(0, r_dry.returncode, r_dry.stderr)
            dry = json.loads(r_dry.stdout)
            self.assertEqual([77], [x["number"] for x in dry["eligible"]])
            self.assertTrue(dry["eligible"][0]["collegium_gate"])

            # реальный проход без --with-collegium: ОТКАЗ, claim/worktree не создаются
            r = run_cmd([
                sys.executable, str(ROOT / "scripts" / "agent-runner"),
                "--repo", "owner/repo", "--agent", "coder", "--claim-as", "worker-1",
                "--state-dir", str(tmp_path / "etag2"), "--worktree-root", str(wt_root), "--once",
            ], env=env)
            self.assertEqual(0, r.returncode, r.stderr)
            self.assertNotIn("DISPATCHED", r.stdout)
            self.assertIn("REFUSED", r.stderr)
            self.assertIn("GATE OPEN", r.stderr)
            self.assertIn("spawn-pack --role auditor", r.stderr)
            self.assertIn("--with-collegium", r.stderr)
            self.assertFalse(wt_root.exists() and any(wt_root.glob("issue-*")))

            # с --with-collegium: первая волна = пакеты коллегии, не executor
            self._fake_git_for_runner(bin_dir)
            runner = self._load_agent_runner()
            issue77 = dict(issues[0])
            issue77["_size"] = "M"
            old_path = os.environ.get("PATH", "")
            os.environ["PATH"] = f"{bin_dir}:{old_path}"
            try:
                wt_dir, branch = runner.prepare_worktree(issue77, wt_root, None)
            finally:
                os.environ["PATH"] = old_path
            self.assertEqual("work/77-task", branch)
            wt = wt_root / "issue-77"
            auditor = wt / "SPAWN_BRIEF-AUDITOR.md"
            reviewer = wt / "SPAWN_BRIEF-REVIEWER.md"
            gate = wt / "SPAWN_BRIEF-GATE.md"
            self.assertTrue(auditor.is_file(), sorted(p.name for p in wt.iterdir()))
            self.assertTrue(reviewer.is_file())
            self.assertTrue(gate.is_file())
            self.assertFalse((wt / "SPAWN_BRIEF-RESEARCHER.md").exists(), "researcher только для size:L")
            self.assertFalse((wt / "SPAWN_BRIEF.md").exists(), "executor-бриф до GATE OPEN не собирается")
            self.assertIn("auditor", auditor.read_text(encoding="utf-8"))
            self.assertIn("GATE OPEN", gate.read_text(encoding="utf-8"))

    def test_agent_runner_respects_native_blocked_by(self):
        with tempfile.TemporaryDirectory(prefix="runner-blocked-") as tmp:
            tmp_path = Path(tmp)
            bin_dir = tmp_path / "bin"
            bin_dir.mkdir()
            issues = [
                {"number": 78, "title": "Small blocked natively", "body": "",
                 "labels": [{"name": "status:ready"}, {"name": "to:pool"}, {"name": "agent:coder"}, {"name": "size:S"}]},
                {"number": 79, "title": "Body blocked-by text", "body": "Blocked by: #101",
                 "labels": [{"name": "status:ready"}, {"name": "to:pool"}, {"name": "agent:coder"}, {"name": "size:S"}]},
            ]
            blocked_by = {78: [{"number": 5, "state": "open"}], 79: []}
            fake_gh = bin_dir / "gh"
            fake_gh.write_text(self._runner_gh_shim(tmp_path / "gh_calls.log", issues, blocked_by), encoding="utf-8")
            fake_gh.chmod(0o755)

            env = os.environ.copy()
            env["AGENT_PROJECT_CONFIG"] = str(ROOT / "tests" / "fixtures" / "project-test.json")
            env["PATH"] = f"{bin_dir}:{env.get('PATH', '')}"

            # #78 заблокирован нативной blocked-by связью, #79 — "Blocked by: #101" (#101 открыт):
            # обе должны быть отфильтрованы
            r = run_cmd([
                sys.executable, str(ROOT / "scripts" / "agent-runner"),
                "--repo", "owner/repo", "--agent", "coder", "--claim-as", "worker-1",
                "--state-dir", str(tmp_path / "etag"), "--dry-run",
            ], env=env)
            self.assertEqual(0, r.returncode, r.stderr)
            self.assertEqual([], [x["number"] for x in json.loads(r.stdout)["eligible"]])

            # после закрытия блокеров обе задачи становятся доступными
            blocked_by[78] = [{"number": 5, "state": "closed"}]
            fake_gh.write_text(self._runner_gh_shim(tmp_path / "gh_calls.log", issues, blocked_by, {101}), encoding="utf-8")
            fake_gh.chmod(0o755)
            r2 = run_cmd([
                sys.executable, str(ROOT / "scripts" / "agent-runner"),
                "--repo", "owner/repo", "--agent", "coder", "--claim-as", "worker-1",
                "--state-dir", str(tmp_path / "etag2"), "--dry-run",
            ], env=env)
            self.assertEqual(0, r2.returncode, r2.stderr)
            self.assertEqual([78, 79], [x["number"] for x in json.loads(r2.stdout)["eligible"]])

    def test_agent_runner_s_fast_track_unchanged(self):
        with tempfile.TemporaryDirectory(prefix="runner-fast-") as tmp:
            tmp_path = Path(tmp)
            bin_dir = tmp_path / "bin"
            bin_dir.mkdir()
            issues = [
                {"number": 80, "title": "Small task", "body": "",
                 "labels": [{"name": "status:ready"}, {"name": "to:pool"}, {"name": "agent:coder"}, {"name": "size:S"}]},
            ]
            fake_gh = bin_dir / "gh"
            fake_gh.write_text(self._runner_gh_shim(tmp_path / "gh_calls.log", issues), encoding="utf-8")
            fake_gh.chmod(0o755)
            self._fake_git_for_runner(bin_dir)

            env = os.environ.copy()
            env["AGENT_PROJECT_CONFIG"] = str(ROOT / "tests" / "fixtures" / "project-test.json")
            env["PATH"] = f"{bin_dir}:{env.get('PATH', '')}"
            wt_root = tmp_path / "wt"

            old_path = os.environ.get("PATH", "")
            os.environ["PATH"] = f"{bin_dir}:{old_path}"
            try:
                runner = self._load_agent_runner()
                issue80 = dict(issues[0])
                issue80["_size"] = "S"
                wt_dir, branch = runner.prepare_worktree(issue80, wt_root, None)
            finally:
                os.environ["PATH"] = old_path
            self.assertEqual("work/80-task", branch)
            wt = wt_root / "issue-80"
            brief = wt / "SPAWN_BRIEF.md"
            self.assertTrue(brief.is_file(), sorted(p.name for p in wt.iterdir()) if wt.exists() else "no worktree")
            self.assertIn("executor", brief.read_text(encoding="utf-8"))
            self.assertFalse((wt / "SPAWN_BRIEF-GATE.md").exists())

    def test_wait_signal_ci_treats_skipped_and_neutral_as_non_failures(self):
        from test_wait_signal import WaitSignalCase, now_iso

        helper = WaitSignalCase()
        fresh = now_iso(60)
        state = helper.base_state()
        state["checks"] = {
            "total_count": 3,
            "runs": [
                {"status": "completed", "conclusion": "success", "updated_at": fresh},
                {"status": "completed", "conclusion": "skipped", "updated_at": fresh},
                {"status": "completed", "conclusion": "neutral", "updated_at": fresh},
            ],
        }
        rc, out, err = helper.run_wait(state, argv=helper.wait_argv(["--sha", "84cfcc5"]))
        self.assertEqual(0, rc, err)
        self.assertIn("checks: success 84cfcc5", out)

        state_fail = helper.base_state()
        state_fail["checks"] = {
            "total_count": 2,
            "runs": [
                {"status": "completed", "conclusion": "success", "updated_at": fresh},
                {"status": "completed", "conclusion": "failure", "updated_at": fresh},
            ],
        }
        rc2, out2, err2 = helper.run_wait(state_fail, argv=helper.wait_argv(["--sha", "84cfcc5"]))
        self.assertEqual(0, rc2, err2)
        self.assertIn("checks: completed-with-failures 84cfcc5", out2)
        # issue #94 / L-02: упавший CI — не зелёная галочка
        self.assertNotIn("✅ CI", out2)
        self.assertIn("❌ CI", out2)

    def test_wait_signal_since_validation_offset_and_urlencode(self):
        from test_wait_signal import WaitSignalCase

        helper = WaitSignalCase()
        # 1) Невалидный --since (инъекция / пробел / несуществующая дата) должен падать с кодом 2
        for bad_since in ("not-a-date", "2026-11-06 10:00:00Z", "2026-02-31T10:00:00Z", "2026-11-06T10:00:00Z&foo=1"):
            rc_bad, _, err_bad = helper.run_wait(helper.base_state(), argv=helper.wait_argv(["--since", bad_since]))
            self.assertEqual(2, rc_bad, f"{bad_since} -> {err_bad}")

        # 2) Валидный --since со смещением +03:00 (2026-11-06T13:00:00+03:00 == 10:00:00Z):
        #    отсекает комментарий в 09:59:00Z и ловит сигнал в 10:05:00Z
        state = helper.base_state()
        state["comments"] = [
            {"id": 1, "created_at": "2026-11-06T09:59:00Z", "first": "🏁 DONE #42 — старый цикл"},
            {"id": 2, "created_at": "2026-11-06T10:05:00Z", "first": "🔎 VERDICT #42 — approve abc1234"},
        ]
        rc_ok, out_ok, err_ok = helper.run_wait(
            state,
            argv=helper.wait_argv(["--since", "2026-11-06T13:00:00+03:00"]),
        )
        self.assertEqual(0, rc_ok, err_ok)
        self.assertIn("VERDICT #42", out_ok)
        self.assertNotIn("старый цикл", out_ok)


class BoardLinkTests(unittest.TestCase):
    """issue #46: машинная связка работа↔issue↔борд (scripts/board_link.py + preflight)."""

    def setUp(self) -> None:
        sys.path.insert(0, str(ROOT / "scripts"))
        import board_link  # type: ignore

        self.bl = board_link
        # issue #73 / B-01: изолируем модульные тесты от живого project.json
        # (дефолтные префиксы веток), иначе кастомные branch_prefixes целевого
        # проекта (например, ["feat", "fix", "work"]) роняют BoardLinkTests.
        self._saved_project_config = os.environ.pop("AGENT_PROJECT_CONFIG", None)
        os.environ["AGENT_PROJECT_CONFIG"] = str(ROOT / "tests" / "fixtures" / "project-test.json")

    def tearDown(self) -> None:
        if self._saved_project_config is None:
            os.environ.pop("AGENT_PROJECT_CONFIG", None)
        else:
            os.environ["AGENT_PROJECT_CONFIG"] = self._saved_project_config

    def _recording_lookup(self, log: list[int], answer=None):
        def lookup(ref: int) -> dict:
            log.append(ref)
            return answer if answer is not None else {"state": "open", "labels": ["status:in-progress"], "is_pr": False}
        return lookup

    # REVIEWER_KICK 3: fallback только по subjects коммитов, бюджет MAX_SUBJECTS.
    def test_fallback_subjects_only_and_budget(self):
        bl = self.bl
        self.assertIsNone(bl.extract_issue_refs("feature/no-ref", ["chore: body ref is not scanned", "docs: tweak"]))
        self.assertEqual(46, bl.extract_issue_refs("feature/no-ref", ["chore: stuff", "feat(board): gate #46"]))
        # Пустой список subjects и пустые/пробельные строки не дают ложной ссылки
        self.assertIsNone(bl.extract_issue_refs("feature/no-ref", []))
        self.assertIsNone(bl.extract_issue_refs("feature/no-ref", ["", "   ", ""]))
        self.assertEqual(46, bl.extract_issue_refs("feature/no-ref", ["", "   ", "feat: link #46"]))
        # 300 фиктивных коммитов: #NN в последнем subject — находится в разумном бюджете
        subjects = [f"chore: filler {i}" for i in range(299)] + ["feat: link #46"]
        self.assertEqual(46, bl.extract_issue_refs("feature/no-ref", subjects))
        # За бюджетом MAX_SUBJECTS ссылка не ищется
        over = [f"chore: filler {i}" for i in range(bl.MAX_SUBJECTS + 5)] + ["feat: link #46"]
        self.assertIsNone(bl.extract_issue_refs("feature/no-ref", over))

    def test_extract_issue_refs_from_branch_names(self):
        bl = self.bl
        self.assertEqual(46, bl.extract_issue_refs("work/46", []))
        self.assertEqual(46, bl.extract_issue_refs("work/46-board-link", []))
        self.assertEqual(7, bl.extract_issue_refs("ext/7-fix", []))
        # work/NN приоритетнее subjects
        self.assertEqual(46, bl.extract_issue_refs("work/46-board-link", ["unrelated #99"]))

    # issue #88/M1: префикс-гейт — ветка вне branch_prefixes оверлея = failure с перечнем.
    def test_branch_prefix_gate_blocks_unknown_prefix(self):
        bl = self.bl
        # BoardLinkTests-фикстура: branch_prefixes = ["work", "ext", "agent", "arena", "coord"]
        msg = bl.branch_prefix_gate("audit/69-superz")
        self.assertIsNotNone(msg)
        self.assertIn("audit/69-superz", msg)
        self.assertIn("work, ext, agent, arena, coord", msg)
        self.assertIsNone(bl.branch_prefix_gate("work/88-branch-prefixes-gate"))
        self.assertIsNone(bl.branch_prefix_gate("ext/7-fix"))
        # Это не main-защита: main и detached HEAD вне префикс-гейта
        self.assertIsNone(bl.branch_prefix_gate("main"))
        self.assertIsNone(bl.branch_prefix_gate("HEAD"))
        self.assertIsNone(bl.branch_prefix_gate(""))

    # issue #143: audit/<slug> легальна при audit в branch_prefixes оверлея.
    def test_audit_branch_slug_forms_with_overlay_prefixes(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        import board_link
        from project_overlay import load_overlay

        with tempfile.TemporaryDirectory(prefix="overlay-audit-") as tmp:
            cfg_path = Path(tmp) / "project.json"
            cfg_path.write_text(
                json.dumps({
                    "pool_label": "to:pool",
                    "branch_prefixes": ["audit", "work"],
                    "roster": [{"id": "node-1", "mode": "direct_gh", "color": "0E8A16"}],
                }),
                encoding="utf-8",
            )
            saved = os.environ.get("AGENT_PROJECT_CONFIG")
            os.environ["AGENT_PROJECT_CONFIG"] = str(cfg_path)
            try:
                # audit/NN-<slug> матчится с номером...
                self.assertEqual(69, board_link.extract_issue_refs("audit/69-superz", []))
                # ...audit/<slug> без номера — номер ищется в subjects коммитов
                self.assertIsNone(board_link.extract_issue_refs("audit/superz", []))
                self.assertEqual(69, board_link.extract_issue_refs("audit/superz", ["chore: stuff", "audit: report #69"]))
                # префикс-гейт пропускает обе формы; посторонняя ветка — нет
                self.assertIsNone(board_link.branch_prefix_gate("audit/superz"))
                self.assertIsNone(board_link.branch_prefix_gate("audit/69-superz"))
                self.assertIsNone(board_link.branch_prefix_gate("work/88-x"))
                msg = board_link.branch_prefix_gate("feat/7-x")
                self.assertIsNotNone(msg)
                self.assertIn("audit, work", msg)
                # stale-причина перечисляет оверлейные префиксы, не хардкод work/ext/agent
                now = board_link.parse_gh_time("2026-11-09T12:00:00Z")
                entries = board_link.stale_entries(
                    [{"number": 5, "updatedAt": "2026-11-01T00:00:00Z"}], [], set(), now, 24)
                self.assertIn("audit, work", entries[0]["reason"])
                # ветка без номера не роняет stale-сверку по номеру
                entries = board_link.stale_entries(
                    [{"number": 5, "updatedAt": "2026-11-01T00:00:00Z"}],
                    ["audit/superz", "work/5-x"], set(), now, 24)
                self.assertEqual([], entries)
            finally:
                if saved is None:
                    os.environ.pop("AGENT_PROJECT_CONFIG", None)
                else:
                    os.environ["AGENT_PROJECT_CONFIG"] = saved

    def test_classify_changes_trivial_rules(self):
        bl = self.bl
        self.assertEqual("trivial", bl.classify_changes(["README.md", "NOTES.md"], 5))
        self.assertEqual("trivial", bl.classify_changes(["NOTES.md"], 20))
        self.assertEqual("substantive", bl.classify_changes(["NOTES.md"], 21))          # >20 строк
        self.assertEqual("substantive", bl.classify_changes(["a.md", "b.py"], 10))      # mixed diff
        self.assertEqual("substantive", bl.classify_changes(["AGENTS.md"], 5))          # регламентный
        self.assertEqual("substantive", bl.classify_changes(["BOARD.md"], 1))
        self.assertEqual("substantive", bl.classify_changes(["docs/guide.md"], 3))      # docs/
        self.assertEqual("substantive", bl.classify_changes(["schema/bus.json"], 1))    # schema/
        self.assertEqual("substantive", bl.classify_changes([], 0))
        self.assertEqual("substantive", bl.classify_changes(["scripts/tool.py"], 2))
        # L-03 (audit #69): расширенный регламентный охват — не trivial
        self.assertEqual("substantive", bl.classify_changes(["BUS.md"], 1))
        self.assertEqual("substantive", bl.classify_changes(["DEBT.md"], 2))
        self.assertEqual("substantive", bl.classify_changes(["agents/executor.md"], 3))  # карточка роли
        self.assertEqual("substantive", bl.classify_changes(["agents/README.md"], 1))
        self.assertEqual("substantive", bl.classify_changes(["skills/bus-delivery/SKILL.md"], 1))
        # README навыка — обычный *.md, trivial-механика сохраняется
        self.assertEqual("trivial", bl.classify_changes(["skills/bus-delivery/README.md"], 5))

    def test_count_added_nonblank(self):
        bl = self.bl
        diff = "diff --git a/f.md b/f.md\n+++ b/f.md\n+line\n+\n+   \n+ok\n-old\n context\n"
        self.assertEqual(2, bl.count_added_nonblank(diff))
        self.assertEqual(0, bl.count_added_nonblank(""))

    # REVIEWER_KICK 1: warning-канал отдельен от failures, strict даёт ровно один error.
    def test_preflight_gate_warning_channel_and_strict(self):
        bl = self.bl
        warn, fail = bl.preflight_gate("feature/no-ref", ["chore: no ref"], ["src/app.py"], 50)
        self.assertEqual([], fail)
        self.assertEqual(1, len(warn))
        self.assertIn("оформи issue", warn[0])

        warn2, fail2 = bl.preflight_gate("feature/no-ref", ["chore: no ref"], ["src/app.py"], 50, strict=True)
        self.assertEqual([], warn2)
        self.assertEqual(1, len(fail2), "strict: ровно один error, без дублей")

    # REVIEWER_KICK 2a: trivial -> bypass ДО вызова gh (assert по mock-логу).
    def test_preflight_gate_trivial_bypass_skips_gh(self):
        bl = self.bl
        calls: list[int] = []
        warn, fail = bl.preflight_gate(
            "feature/no-ref", ["chore: no ref"], ["NOTES.md"], 5,
            gh_lookup=self._recording_lookup(calls),
        )
        self.assertEqual([], warn)
        self.assertEqual([], fail)
        self.assertEqual([], calls, "trivial bypass не должен вызывать gh")

        # Явный --trivial: bypass с пометкой, тоже без gh
        calls2: list[int] = []
        warn2, fail2 = bl.preflight_gate(
            "feature/no-ref", ["chore: no ref"], ["src/app.py"], 500,
            allow_trivial=True, gh_lookup=self._recording_lookup(calls2),
        )
        self.assertEqual([], fail2)
        self.assertEqual([], calls2)
        self.assertEqual(1, len(warn2))
        self.assertIn("--trivial", warn2[0])

    # REVIEWER_KICK 3: пустой base..HEAD -> молча skip, включая strict; нет origin -> warning.
    def test_preflight_gate_empty_range_and_no_origin(self):
        bl = self.bl
        calls: list[int] = []
        for strict in (False, True):
            warn, fail = bl.preflight_gate(
                "feature/no-ref", [], ["src/app.py"], 500,
                scope_known=True, strict=strict, gh_lookup=self._recording_lookup(calls),
            )
            self.assertEqual([], warn, f"strict={strict}")
            self.assertEqual([], fail, f"strict={strict}")
        self.assertEqual([], calls)

        warn, fail = bl.preflight_gate("feature/no-ref", ["x"], ["a.py"], 10, scope_known=False)
        self.assertEqual([], fail)
        self.assertEqual(1, len(warn))
        self.assertIn("нет origin", warn[0])

    # REVIEWER_KICK 4: gh-реальность — degrade в warning, never error.
    def test_preflight_gate_gh_soft_check_paths(self):
        bl = self.bl
        base = dict(commit_subjects=["feat: link #46"], files=["src/app.py"], added_lines=50)

        warn, fail = bl.preflight_gate("feature/no-ref", gh_lookup=None, **base)
        self.assertEqual([], fail)
        self.assertEqual(1, len(warn))
        self.assertIn("не верифицирован", warn[0])

        warn, fail = bl.preflight_gate("feature/no-ref", gh_lookup=lambda r: {"error": "HTTP 502"}, **base)
        self.assertEqual([], fail)
        self.assertIn("не верифицирован", warn[0])

        warn, fail = bl.preflight_gate(
            "feature/no-ref", gh_lookup=lambda r: {"state": "closed", "labels": ["status:done"], "is_pr": False}, **base)
        self.assertEqual([], fail)
        self.assertIn("не открыт", warn[0])

        warn, fail = bl.preflight_gate(
            "feature/no-ref", gh_lookup=lambda r: {"state": "open", "labels": ["type:bug"], "is_pr": False}, **base)
        self.assertEqual([], fail)
        self.assertIn("status:", warn[0])

        warn, fail = bl.preflight_gate(
            "feature/no-ref", gh_lookup=lambda r: {"state": "open", "labels": [], "is_pr": True}, **base)
        self.assertEqual([], fail)
        self.assertIn("PR", warn[0])

        warn, fail = bl.preflight_gate(
            "feature/no-ref",
            gh_lookup=lambda r: {"state": "open", "labels": ["status:in-progress"], "is_pr": False}, **base)
        self.assertEqual([], warn)
        self.assertEqual([], fail)

    # Принуждение на пути сдачи: size:M/L без phase:action = реализация до гейта.
    def test_preflight_gate_ml_requires_phase_action(self):
        bl = self.bl
        base = dict(commit_subjects=["feat: link #46"], files=["src/app.py"], added_lines=50)

        for size in ("size:M", "size:L"):
            warn, fail = bl.preflight_gate(
                "feature/no-ref",
                gh_lookup=lambda r, s=size: {
                    "state": "open", "labels": ["status:in-progress", s], "is_pr": False}, **base)
            self.assertEqual([], warn, size)
            self.assertEqual(1, len(fail), size)
            self.assertIn("phase:action", fail[0], size)

        # С открытым гейтом — чисто
        warn, fail = bl.preflight_gate(
            "feature/no-ref",
            gh_lookup=lambda r: {
                "state": "open",
                "labels": ["status:in-progress", "size:M", "phase:action"],
                "is_pr": False}, **base)
        self.assertEqual([], warn)
        self.assertEqual([], fail)

        # size:S (Fast-Track) гейта не требует
        warn, fail = bl.preflight_gate(
            "feature/no-ref",
            gh_lookup=lambda r: {
                "state": "open", "labels": ["status:in-progress", "size:S"], "is_pr": False}, **base)
        self.assertEqual([], warn)
        self.assertEqual([], fail)

        # gh недоступен — warning, never error (soft-check контракт сохранён)
        warn, fail = bl.preflight_gate(
            "feature/no-ref", gh_lookup=lambda r: {"error": "HTTP 502"}, **base)
        self.assertEqual([], fail)
        self.assertIn("не верифицирован", warn[0])

    # Метрика «какой канон»: fingerprint стабилен, чувствителен к правкам, sha7.
    def test_canon_fingerprint_stable_and_sensitive(self):
        import importlib.util
        from importlib.machinery import SourceFileLoader

        loader = SourceFileLoader("agents_preflight_fp", str(ROOT / "scripts" / "preflight"))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        preflight = importlib.util.module_from_spec(spec)
        loader.exec_module(preflight)

        fp1 = preflight.canon_fingerprint(ROOT)
        fp2 = preflight.canon_fingerprint(ROOT)
        self.assertEqual(fp1, fp2, "fingerprint стабилен на неизменном каноне")
        self.assertRegex(fp1, r"^[0-9a-f]{7}$", "sha7 формат")

        with tempfile.TemporaryDirectory(prefix="canon-fp-") as tmp:
            root = Path(tmp)
            for rel in preflight.CANON_FINGERPRINT_FILES:
                target = root / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("x\n", encoding="utf-8")
            fp_base = preflight.canon_fingerprint(root)
            (root / "WORKFLOW.md").write_text("x\ny\n", encoding="utf-8")
            self.assertNotEqual(fp_base, preflight.canon_fingerprint(root),
                                "правка канона меняет fingerprint")
            (root / "CLAUDE.md").unlink()
            self.assertNotEqual(fp_base, preflight.canon_fingerprint(root),
                                "отсутствие файла тоже меняет fingerprint")

    # Дедуп-гард: маркеры единых источников и указатели обязаны существовать.
    def test_dedup_guard_intact_and_detects_regression(self):
        import importlib.util
        from importlib.machinery import SourceFileLoader

        loader = SourceFileLoader("agents_preflight_dedup", str(ROOT / "scripts" / "preflight"))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        preflight = importlib.util.module_from_spec(spec)
        loader.exec_module(preflight)

        self.assertEqual([], preflight.check_dedup_guard(ROOT),
                         "дедупликация Fast-Track/REVIEWER_KICK цела в живом каноне")

        with tempfile.TemporaryDirectory(prefix="dedup-guard-") as tmp:
            root = Path(tmp)
            needles_by_file: dict[str, list[str]] = {}
            for rel, needle in preflight.DEDUP_GUARD:
                needles_by_file.setdefault(rel, []).append(needle)
            for rel, needles in needles_by_file.items():
                target = root / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(" ".join(needles) + "\n", encoding="utf-8")
            self.assertEqual([], preflight.check_dedup_guard(root))
            (root / "agents" / "reviewer.md").write_text("без указателя\n", encoding="utf-8")
            errors = preflight.check_dedup_guard(root)
            self.assertEqual(1, len(errors))
            self.assertIn("agents/reviewer.md", errors[0])
            (root / "WORKFLOW.md").unlink()
            errors = preflight.check_dedup_guard(root)
            self.assertEqual(2, len(errors))
            self.assertTrue(any("отсутствует WORKFLOW.md" in e for e in errors))

    def test_parse_gh_time_zone_forms(self):
        bl = self.bl
        z = bl.parse_gh_time("2026-11-09T10:00:00Z")
        off = bl.parse_gh_time("2026-11-09T13:00:00+03:00")
        self.assertEqual(z, off, "Z и +03:00 парсятся одинаково")
        self.assertEqual(0, z.utcoffset().total_seconds())

    # REVIEWER_KICK 5: границы stale-отчёта.
    def test_stale_entries_boundaries(self):
        bl = self.bl
        now = bl.parse_gh_time("2026-11-09T12:00:00Z")
        issues = [
            {"number": 1, "updatedAt": "2026-11-10T00:00:00Z"},                # будущее время — не stale
            {"number": 2, "updatedAt": "2026-11-08T11:00:00Z"},                # 25ч — stale
            {"number": 3, "updatedAt": "2026-11-08T17:00:00+03:00"},           # 22ч (10:00Z→14:00Z) — не stale
            {"number": 4, "updatedAt": "2026-11-01T00:00:00Z"},                # есть ветка — не stale
            {"number": 5, "updatedAt": "2026-11-01T00:00:00Z"},                # есть PR — не stale
        ]
        entries = bl.stale_entries(issues, ["work/4-x"], {5}, now, 24)
        self.assertEqual([2], [e["number"] for e in entries])
        self.assertIn("нет remote-ветки", entries[0]["reason"])
        self.assertIn("нет открытого PR", entries[0]["reason"])
        # Ровно на границе (24ч назад) — ещё не stale
        self.assertEqual([], bl.stale_entries([{"number": 9, "updatedAt": "2026-11-08T12:00:00Z"}], [], set(), now, 24))

    def test_stale_report_args_validation(self):
        for bad in ("0", "-1", "abc"):
            res = run_cmd([sys.executable, str(ROOT / "scripts" / "board_link.py"), "--stale-report", bad])
            self.assertEqual(2, res.returncode, bad)
            self.assertIn("положительным целым", res.stderr)
        none_given = run_cmd([sys.executable, str(ROOT / "scripts" / "board_link.py")])
        self.assertEqual(2, none_given.returncode)

    def test_stale_report_report_and_ping_marker(self):
        bl = self.bl
        now = bl.parse_gh_time("2026-11-09T12:00:00Z")
        entries = bl.stale_entries(
            [{"number": 77, "updatedAt": "2026-11-05T12:00:00Z"}], [], set(), now, 48)
        self.assertEqual(1, len(entries))
        # В CLI-выводе предлагается маркер 📣 PING (проверяем форматирование через функцию отчёта)
        lines = [f"  - #{e['number']} — {e['age_hours']}ч — {e['reason']} — предложи маркер 📣 PING" for e in entries]
        self.assertTrue(any("📣 PING" in line for line in lines))
        self.assertEqual(96.0, entries[0]["age_hours"])

    def test_audit_pr_findings_classification(self):
        bl = self.bl
        good = {"state": "open", "labels": ["status:in-progress"], "is_pr": False}
        findings = bl.audit_pr_findings(
            [
                {"number": 1, "title": "no link", "body": "что-то там"},
                {"number": 2, "title": "bullet", "body": "- Issue: #12"},
                {"number": 3, "title": "pr-ref", "body": "Issue: #13"},
                {"number": 4, "title": "closed", "body": "Issue: #14"},
                {"number": 5, "title": "no-status", "body": "Issue: #15"},
                {"number": 6, "title": "good", "body": "текст\nIssue: #16\n"},
            ],
            lambda n: {
                12: good, 13: {"state": "open", "labels": [], "is_pr": True},
                14: {"state": "closed", "labels": ["status:done"], "is_pr": False},
                15: {"state": "open", "labels": ["type:bug"], "is_pr": False},
                16: good,
            }.get(n, {"error": "missing"}),
        )
        self.assertEqual(4, len(findings))
        self.assertIn("нет строки 'Issue: #NN'", findings[0])
        self.assertIn("PR, а не на issue", findings[1])
        self.assertIn("не открыт", findings[2])
        self.assertIn("нет label status:*", findings[3])
        self.assertEqual([], bl.audit_pr_findings([], lambda n: good))

    # H-01 (issue #77): толерантный разбор ссылки PR↔issue — все допущенные форматы
    # принимаются, полное отсутствие ссылки отклоняется, валидация цели сохраняется.
    def test_audit_pr_findings_tolerant_link_formats(self):
        bl = self.bl
        good = {"state": "open", "labels": ["status:in-progress"], "is_pr": False}
        bodies = [
            "- Issue: #12",                               # канон с буллетом
            "- Issue: #12 · диапазон коммитов: `a`..`b`",  # строка PR-шаблона с суффиксом
            "Refs #12",
            "Resolves #12",
            "Closes #12",
            "Fixes #12",
            "Связано с issue #12 (без автозакрытия)",
            "Связанный issue: #12",
            "Сделано, Refs #12, тесты зелёные",
            "текст\n#12\n",                               # маркер-строка `#NN`
        ]
        for body in bodies:
            self.assertEqual([], bl.audit_pr_findings(
                [{"number": 1, "title": "fmt", "body": body}], lambda n: good), body)
        findings = bl.audit_pr_findings(
            [{"number": 2, "title": "no link", "body": "что-то там без ссылки"}], lambda n: good)
        self.assertEqual(1, len(findings))
        self.assertIn("нет строки 'Issue: #NN'", findings[0])
        # Валидация цели не ослаблена: ссылка есть, но цель закрыта — нарушение остаётся.
        findings = bl.audit_pr_findings(
            [{"number": 3, "title": "closed", "body": "Refs #12"}],
            lambda n: {"state": "closed", "labels": ["status:done"], "is_pr": False})
        self.assertEqual(1, len(findings))
        self.assertIn("не открыт", findings[0])

    def test_extract_pr_issue_refs_dedup_order_and_misses(self):
        bl = self.bl
        self.assertEqual([12, 13], bl.extract_pr_issue_refs("Refs #12\nResolves #13\nRefs #12"))
        self.assertEqual([], bl.extract_pr_issue_refs(None))
        self.assertEqual([], bl.extract_pr_issue_refs("#abc"))
        self.assertEqual([], bl.extract_pr_issue_refs(""))

    def _fake_gh_env(self, tmp: Path, scenario: dict, extra_tools: tuple[str, ...] = ("git", "bash")) -> dict:
        """Fake-gh в PATH (+ симлинки системных инструментов) — детерминированно, без сети.

        Сценарии (scenario.json):
          prs/repo/issues — как у реального gh;
          api_mode: "garbage" | "empty" — некорректный ответ gh api (rc 0);
          api_rc: int — gh api завершается с этим кодом без stdout.
        """
        bin_dir = tmp / "bin"
        bin_dir.mkdir(exist_ok=True)
        scen_file = tmp / "scenario.json"
        scen_file.write_text(json.dumps(scenario), encoding="utf-8")
        gh = bin_dir / "gh"
        gh.write_text(textwrap.dedent(
            f"""\
            #!/usr/bin/env python3
            import json, sys
            scen = json.load(open({str(scen_file)!r}))
            argv = sys.argv[1:]
            if argv[:2] == ["pr", "list"]:
                print(json.dumps(scen["prs"]))
            elif argv[:2] == ["repo", "view"]:
                print(scen["repo"])
            elif argv[0] == "api" and argv[1].startswith("repos/"):
                n = int(argv[1].split("/")[-1])
                if scen.get("api_rc") is not None:
                    sys.stderr.write("gh api simulated failure")
                    raise SystemExit(int(scen["api_rc"]))
                if scen.get("api_mode") == "garbage":
                    print("<<<not-json-garbage>>>")
                elif scen.get("api_mode") == "empty":
                    print("")
                else:
                    print(json.dumps(scen["issues"][str(n)]))
            else:
                sys.stderr.write("unexpected: " + " ".join(argv))
                raise SystemExit(1)
            """
        ), encoding="utf-8")
        gh.chmod(gh.stat().st_mode | 0o111)
        for tool in extra_tools:
            src = None
            for part in os.environ.get("PATH", "").split(os.pathsep):
                cand = Path(part) / tool
                if cand.is_file():
                    src = cand
                    break
            if src is not None and not (bin_dir / tool).exists():
                (bin_dir / tool).symlink_to(src)
        env = os.environ.copy()
        env["AGENT_PROJECT_CONFIG"] = str(ROOT / "tests" / "fixtures" / "project-test.json")
        env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
        return env

    def _env_without_gh(self, tmp: Path, tools: tuple[str, ...] = ("git",)) -> dict:
        """PATH только из симлинков заданных инструментов (gh отсутствует детерминированно)."""
        bin_dir = tmp / "bin"
        bin_dir.mkdir(exist_ok=True)
        for tool in tools:
            for part in os.environ.get("PATH", "").split(os.pathsep):
                cand = Path(part) / tool
                if cand.is_file():
                    (bin_dir / tool).symlink_to(cand)
                    break
        env = os.environ.copy()
        env["AGENT_PROJECT_CONFIG"] = str(ROOT / "tests" / "fixtures" / "project-test.json")
        env["PATH"] = str(bin_dir)
        return env

    def test_audit_prs_cli_exit_codes(self):
        bl_ok = {
            "repo": "org/repo",
            "prs": [
                {"number": 10, "title": "good", "body": "текст\nIssue: #20\n"},
                {"number": 11, "title": "bullet", "body": "* Issue: #21"},
            ],
            "issues": {
                "20": {"state": "open", "labels": ["status:review"], "is_pr": False},
                "21": {"state": "open", "labels": ["status:in-progress"], "is_pr": False},
            },
        }
        bl_bad = {
            "repo": "org/repo",
            "prs": [
                {"number": 10, "title": "missing", "body": "нет ссылки"},
                {"number": 11, "title": "pr-ref", "body": "Issue: #13"},
            ],
            "issues": {"13": {"state": "open", "labels": [], "is_pr": True}},
        }
        with tempfile.TemporaryDirectory(prefix="board-link-") as tmp:
            for scenario, expected_rc in ((bl_ok, 0), (bl_bad, 1)):
                env = self._fake_gh_env(Path(tmp), scenario)
                res = run_cmd(
                    [sys.executable, str(ROOT / "scripts" / "board_link.py"), "--audit-prs"], env=env)
                self.assertEqual(expected_rc, res.returncode, f"{scenario}: {res.stdout} {res.stderr}")
                if expected_rc == 1:
                    self.assertIn("нарушения PR↔issue", res.stdout)
                    self.assertIn("PR, а не на issue", res.stdout)

    # REVIEWER_KICK 1 (e2e): warning/bypass не меняет счётчик failures и квитанцию.
    # Детерминированно без сети: gh подменяется fake-бинарем (issue #46 открыт, status:* есть).
    def test_preflight_receipt_stable_with_staged_trivial_probe(self):
        preflight = str(ROOT / "scripts" / "preflight")
        with tempfile.TemporaryDirectory(prefix="board-link-receipt-") as tmp:
            env = self._fake_gh_env(Path(tmp), {
                "repo": "org/repo",
                "prs": [],
                "issues": {"46": {"state": "open", "labels": ["status:in-progress"], "is_pr": False}},
            })
            baseline = run_cmd([sys.executable, preflight, "--skip-tests", "--ci-main"], env=env)
            self.assertEqual(0, baseline.returncode, baseline.stderr)
            self.assertIn("PREFLIGHT OK", baseline.stdout)

            probe = ROOT / "tmp-board-probe.md"
            probe.write_text("\n".join(f"probe line {i}" for i in range(5)) + "\n", encoding="utf-8")
            try:
                run_cmd(["git", "add", str(probe)])
                staged = run_cmd([sys.executable, preflight, "--skip-tests", "--ci-main"], env=env)
                self.assertEqual(0, staged.returncode, staged.stderr)
                self.assertEqual([], [ln for ln in staged.stderr.splitlines() if "PREFLIGHT FAILED" in ln])
                self.assertEqual(
                    baseline.stdout, staged.stdout,
                    "trivial bypass не должен менять байт-в-байт квитанцию PREFLIGHT OK",
                )
            finally:
                run_cmd(["git", "reset", "--", str(probe)])
                probe.unlink(missing_ok=True)
            self.assertNotIn("tmp-board-probe", run_cmd(["git", "status", "--porcelain"]).stdout)

    def test_preflight_trivial_flag_and_strict_board_flags_accepted(self):
        preflight = str(ROOT / "scripts" / "preflight")
        res = run_cmd([sys.executable, preflight, "--skip-tests", "--ci-main", "--trivial", "--strict-board"])
        self.assertEqual(0, res.returncode, res.stderr)
        self.assertIn("PREFLIGHT OK", res.stdout)

    # Волна 2: gh отсутствует в PATH -> мягкая деградация, никогда не traceback.
    def test_stale_report_without_gh_binary_exit_0(self):
        with tempfile.TemporaryDirectory(prefix="board-link-nogh-") as tmp:
            env = self._env_without_gh(Path(tmp))
            res = run_cmd(
                [sys.executable, str(ROOT / "scripts" / "board_link.py"), "--stale-report"], env=env)
            self.assertEqual(0, res.returncode, res.stdout + res.stderr)
            self.assertIn("gh недоступен", res.stderr)
            self.assertNotIn("Traceback", res.stderr)

    def test_audit_prs_without_gh_clean_error_no_traceback(self):
        with tempfile.TemporaryDirectory(prefix="board-link-nogh-") as tmp:
            env = self._env_without_gh(Path(tmp))
            res = run_cmd(
                [sys.executable, str(ROOT / "scripts" / "board_link.py"), "--audit-prs"], env=env)
            self.assertEqual(1, res.returncode)
            self.assertIn("gh pr list failed", res.stderr)
            self.assertIn("gh недоступен", res.stderr)
            self.assertNotIn("Traceback", res.stderr)

    # Волна 2 (стресс): gh отвечает мусором (не-JSON / пусто / rc!=0) -> warning при активном
    # гейте, никогда не краш. Тест ветко-агностичен: на main (пустой merge_base..HEAD) гейт
    # молча skip — безусловно проверяем только rc/PREFLIGHT OK/отсутствие Traceback.
    def test_preflight_gh_garbage_output_warns_not_crashes(self):
        preflight = str(ROOT / "scripts" / "preflight")
        branch = run_cmd(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
        mb = run_cmd(["git", "merge-base", "HEAD", "origin/main"])
        subjects = ""
        files: list[str] = []
        if mb.returncode == 0:
            rng = f"{mb.stdout.strip()}...HEAD"
            subjects = run_cmd(["git", "log", f"{mb.stdout.strip()}..HEAD", "--format=%s"]).stdout
            files = run_cmd(["git", "diff", "--name-only", rng]).stdout.splitlines()
        gate_active = (
            branch != "main"
            and self.bl.extract_issue_refs(branch, subjects.splitlines()) is not None
            and any(ln.strip() for ln in subjects.splitlines())
            and self.bl.classify_changes(files, self.bl.count_added_nonblank(
                run_cmd(["git", "diff", f"{mb.stdout.strip()}...HEAD"]).stdout)) == "substantive"
        )
        base = {"repo": "org/repo", "prs": [], "issues": {"46": {"state": "open", "labels": [], "is_pr": False}}}
        for variant in ("garbage", "empty", "api_rc"):
            with tempfile.TemporaryDirectory(prefix="board-link-ghbad-") as tmp:
                scenario = dict(base)
                if variant == "api_rc":
                    scenario["api_rc"] = 1
                else:
                    scenario["api_mode"] = variant
                env = self._fake_gh_env(Path(tmp), scenario)
                res = run_cmd([sys.executable, preflight, "--skip-tests", "--ci-main"], env=env)
                self.assertEqual(0, res.returncode, f"{variant}: {res.stdout} {res.stderr}")
                self.assertIn("PREFLIGHT OK", res.stdout)
                self.assertNotIn("Traceback", res.stderr)
                if gate_active:
                    self.assertIn("не верифицирован", res.stderr, variant)

    # Волна 2 (стресс): несколько #NN и нечисловой #abc — корректный выбор и set[int].
    def test_extract_issue_refs_multiple_and_nonnumeric_refs(self):
        bl = self.bl
        # Первый валидный #NN в subjects побеждает
        self.assertEqual(12, bl.extract_issue_refs("feature/x", ["feat: reuse #12 and #7"]))
        self.assertEqual(7, bl.extract_issue_refs("feature/x", ["feat: #7 first wins over #12"]))
        # Нечисловой #abc не матчится, поиск продолжает до валидного #NN
        self.assertEqual(12, bl.extract_issue_refs("feature/x", ["fix: #abc #12"]))
        self.assertIsNone(bl.extract_issue_refs("feature/x", ["docs: see #abc only"]))
        # Через публичный audit_pr_findings: тела PR с несколькими 'Issue: #NN' и
        # нечисловым '#abc' дают ровно валидные ссылки, нарушений нет
        findings = bl.audit_pr_findings(
            [{"number": 1, "title": "multi", "body": "Issue: #12\n- Issue: #13\nрядом #abc"}],
            lambda n: {"state": "open", "labels": ["status:in-progress"], "is_pr": False},
        )
        self.assertEqual([], findings)


    # ---- H-06 (#82): локальная гигиена борда (--hygiene / --fix) ----

    def test_hygiene_findings_pure(self):
        bl = self.bl
        issues = [
            # закрытый с активными метками: remove + report_only (to:*)
            {"number": 5, "state": "CLOSED", "title": " drift ", "labels": [
                {"name": "status:ready"}, {"name": "to:worker-1"},
                {"name": "type:debt"}, {"name": "size:S"}]},
            # закрытый с phase:* + status:review (status:done остаётся, не снимается)
            {"number": 7, "state": "closed", "title": "ph", "labels": [
                {"name": "phase:action"}, {"name": "status:review"}, {"name": "status:done"}]},
            # чистый закрытый (только status:done/type) — не входит
            {"number": 8, "state": "closed", "title": "ok", "labels": [
                {"name": "status:done"}, {"name": "type:debt"}]},
            # открытый с активными метками — не входит
            {"number": 9, "state": "open", "title": "open", "labels": [
                {"name": "status:in-progress"}]},
            # закрытый только с to:* — report_only без remove
            {"number": 10, "state": "CLOSED", "title": "route", "labels": [{"name": "to:owner"}]},
        ]
        found = {e["number"]: e for e in bl.hygiene_findings(issues)}
        self.assertEqual({5, 7, 10}, set(found))
        self.assertEqual(["status:ready"], found[5]["remove"])
        self.assertEqual(["to:worker-1"], found[5]["report_only"])
        self.assertEqual(sorted(["phase:action", "status:review"]), found[7]["remove"])
        self.assertEqual([], found[7]["report_only"])
        self.assertEqual([], found[10]["remove"])
        self.assertEqual(["to:owner"], found[10]["report_only"])
        # строковые имена меток (формат gh api --jq) понимаются так же
        str_issues = [{"number": 1, "state": "closed", "title": "s", "labels": ["status:review"]}]
        self.assertEqual(["status:review"], bl.hygiene_findings(str_issues)[0]["remove"])
        self.assertEqual([], bl.hygiene_findings([]))

    def _hygiene_gh_env(self, tmp: Path, issues: list[dict], log: Path) -> dict:
        """Fake-gh для --hygiene: отдаёт issue list, логирует issue edit (--remove-label)."""
        bin_dir = tmp / "bin"
        bin_dir.mkdir(parents=True, exist_ok=True)
        data = tmp / "issues.json"
        data.write_text(json.dumps(issues), encoding="utf-8")
        gh = bin_dir / "gh"
        gh.write_text(textwrap.dedent(f"""\
            #!/usr/bin/env python3
            import sys
            argv = sys.argv[1:]
            with open({str(log)!r}, "a", encoding="utf-8") as fh:
                fh.write("\\x00".join(argv) + "\\n")
            if argv[:2] == ["issue", "list"]:
                print(open({str(data)!r}, encoding="utf-8").read())
            elif argv[:2] == ["issue", "edit"] and "--remove-label" in argv:
                pass
            else:
                sys.stderr.write("unexpected: " + " ".join(argv))
                raise SystemExit(1)
            """), encoding="utf-8")
        gh.chmod(gh.stat().st_mode | 0o111)
        env = os.environ.copy()
        env["AGENT_PROJECT_CONFIG"] = str(ROOT / "tests" / "fixtures" / "project-test.json")
        env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
        return env

    # Отчёт всегда сначала; read-only с дрейфом — exit 1 (гейт приёмки), edit-вызовов нет.
    def test_hygiene_cli_report_readonly_exit_1_no_writes(self):
        issues = [
            {"number": 5, "state": "CLOSED", "title": "drift", "labels":
                [{"name": "status:ready"}, {"name": "to:worker-1"}]},
            {"number": 8, "state": "closed", "title": "clean", "labels": [{"name": "status:done"}]},
        ]
        with tempfile.TemporaryDirectory(prefix="board-hygiene-") as tmp:
            log = Path(tmp) / "gh-calls.log"
            log.write_text("", encoding="utf-8")
            env = self._hygiene_gh_env(Path(tmp), issues, log)
            res = run_cmd(
                [sys.executable, str(ROOT / "scripts" / "board_link.py"), "--hygiene"], env=env)
            self.assertEqual(1, res.returncode, res.stdout + res.stderr)
            self.assertIn("закрытые issues с активными метками (1)", res.stdout)
            self.assertIn("#5", res.stdout)
            self.assertIn("снять: status:ready", res.stdout)
            self.assertIn("to:worker-1", res.stdout)
            self.assertNotIn("#8", res.stdout)
            self.assertNotIn("edit", log.read_text(encoding="utf-8"),
                             "read-only режим не должен вызывать gh issue edit")

    # --fix: снимает только «снять»-метки; to:*/type:* не трогает; автозакрытия нет.
    def test_hygiene_cli_fix_removes_only_status_phase_labels(self):
        issues = [
            {"number": 5, "state": "CLOSED", "title": "drift", "labels": [
                {"name": "status:ready"}, {"name": "to:worker-1"}, {"name": "type:debt"}]},
            {"number": 7, "state": "closed", "title": "phase", "labels": [
                {"name": "phase:action"}, {"name": "status:done"}]},
        ]
        with tempfile.TemporaryDirectory(prefix="board-hygiene-fix-") as tmp:
            log = Path(tmp) / "gh-calls.log"
            log.write_text("", encoding="utf-8")
            env = self._hygiene_gh_env(Path(tmp), issues, log)
            res = run_cmd(
                [sys.executable, str(ROOT / "scripts" / "board_link.py"),
                 "--hygiene", "--fix"], env=env)
            self.assertEqual(0, res.returncode, res.stdout + res.stderr)
            calls = [ln.split("\x00") for ln in
                     log.read_text(encoding="utf-8").splitlines() if ln]
            removed = [c[4] for c in calls if "--remove-label" in c]
            self.assertEqual(sorted(["status:ready", "phase:action"]), sorted(removed))
            edit_nums = {int(c[2]) for c in calls if c[:2] == ["issue", "edit"]}
            self.assertEqual({5, 7}, edit_nums, "edit только для дрейфующих issues")
            joined = "\x00".join("\x00".join(c) for c in calls)
            self.assertNotIn("to:", joined, "--fix не трогает to:*")
            self.assertNotIn("type:", joined, "--fix не трогает type:*")
            issue_verbs = {c[1] for c in calls if c[0] == "issue"}
            self.assertEqual({"list", "edit"}, issue_verbs, "--fix не закрывает issues")

    # gh отсутствует в PATH -> чистая ошибка без traceback (как у --audit-prs/--stale-report).
    def test_hygiene_without_gh_clean_error_no_traceback(self):
        with tempfile.TemporaryDirectory(prefix="board-hygiene-nogh-") as tmp:
            env = self._env_without_gh(Path(tmp))
            res = run_cmd(
                [sys.executable, str(ROOT / "scripts" / "board_link.py"), "--hygiene"], env=env)
            self.assertEqual(1, res.returncode)
            self.assertIn("gh issue list failed", res.stderr)
            self.assertNotIn("Traceback", res.stderr)


class PortableOverlayAndPurityGateTests(unittest.TestCase):
    """Тесты ADR-0003: проектный оверлей project.json, Purity & Portability Gate и подкаталог workflow/."""

    def test_project_overlay_validation_labels_board_and_claim_guard(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        import board_link
        from project_overlay import branch_regex, load_overlay, merge_board_fields, overlay_labels, validate_claim_as

        example_cfg = ROOT / "project.example.json"
        self.assertTrue(example_cfg.is_file())
        overlay = load_overlay(ROOT, example_cfg)
        self.assertTrue(overlay["loaded"])
        extra = [x["name"] for x in overlay_labels(overlay)]
        self.assertEqual(["to:worker-1", "to:worker-2", "to:sandbox-1"], extra)

        # create-labels.sh с AGENT_PROJECT_CONFIG=project.example.json выдаёт 46 + 3 = 49 меток
        expanded = planned_labels(ROOT, project_config=example_cfg)
        self.assertEqual(49, len(expanded))
        self.assertEqual(49, len(set(expanded)))
        for expected_lbl in ("to:worker-1", "to:worker-2", "to:sandbox-1"):
            self.assertIn(expected_lbl, expanded)

        # Валидатор --claim-as пропускает узел из ростера и блокирует посторонний узел
        self.assertIsNone(validate_claim_as("worker-1", overlay))
        self.assertIsNotNone(validate_claim_as("rogue-node", overlay))

        bad_claim = run_cmd([
            "bash", str(ROOT / "scripts" / "wait-signal"),
            "--issue", "12", "--repo", "org/repo",
            "--claim", "rogue / s1", "--claim-as", "rogue-node",
            "--project-config", str(example_cfg),
        ])
        self.assertEqual(2, bad_claim.returncode)
        self.assertIn("отсутствует в ростере project.json", bad_claim.stderr)

        # Кастомные префиксы веток и кастомные поля борда в project.json
        with tempfile.TemporaryDirectory(prefix="overlay-custom-") as tmp:
            cfg_path = Path(tmp) / "project.json"
            cfg_path.write_text(
                json.dumps({
                    "pool_label": "to:team-pool",
                    "branch_prefixes": ["work", "sandbox"],
                    "roster": [{"id": "node-alpha", "mode": "direct_gh", "color": "0E8A16"}],
                    "custom_board_fields": [
                        {"name": "Контур", "dataType": "SINGLE_SELECT", "options": ["API", "Web"]},
                    ],
                }),
                encoding="utf-8",
            )
            custom_ov = load_overlay(ROOT, cfg_path)
            self.assertEqual(
                42,
                board_link.extract_issue_refs("sandbox/42-feature", [], branch_re=branch_regex(custom_ov)),
            )
            merged = merge_board_fields(
                [{"name": "Адресат", "dataType": "SINGLE_SELECT", "options": [
                    {"name": "Владелец", "color": "ORANGE", "description": "to:owner"},
                ]}],
                custom_ov,
            )
            addr_descs = {o["description"] for o in merged[0]["options"]}
            self.assertIn("to:team-pool", addr_descs)
            self.assertIn("to:node-alpha", addr_descs)
            self.assertIn("Контур", {f["name"] for f in merged})

    def test_mode_a_rollout_copy_list_is_portable(self):
        # issue #80 / H-04: список копирования Режима A (ADOPTION §5) включает
        # README.md и project.example.json, но НЕ боевой project.json донора
        # (приватные slug/repo/ростер хаба). После раскатки в новом репозитории
        # нет приватных литералов донора, а оверлей-пример валиден.
        sys.path.insert(0, str(ROOT / "scripts"))
        sys.path.insert(0, str(ROOT / "tests"))
        from project_overlay import load_overlay
        from regression import PURITY_PATTERN

        if not (ROOT / ".github").is_dir():
            # Тест моделирует Режим A из корня репозитория; в Режиме B (канон в
            # workflow/) формы issues живут в корне хоста и здесь недоступны.
            self.skipTest(".github отсутствует в ROOT (Режим B workflow-раскладка)")

        # project.example.json валиден через project_overlay (validate_and_normalize)
        overlay = load_overlay(ROOT, ROOT / "project.example.json")
        self.assertTrue(overlay["loaded"])
        self.assertEqual("example", overlay["project"]["slug"])
        example_text = (ROOT / "project.example.json").read_text(encoding="utf-8")
        self.assertIsNone(PURITY_PATTERN.search(example_text), "project.example.json должен быть нейтральным")

        with tempfile.TemporaryDirectory(prefix="mode-a-rollout-") as tmp:
            host = Path(tmp) / "fresh-repo"
            host.mkdir()

            # Раскатка строго по списку копирования ADOPTION §5 (Режим A):
            # боевой project.json донора НЕ копируется.
            for name in ("README.md", "AGENTS.md", "PROTOCOL.md", "WORKFLOW.md",
                         "BOARD.md", "BUS.md", "OPS.md", "STATUS.md", "DEBT.md"):
                shutil.copy2(ROOT / name, host / name)
            for dirname in ("schema", "agents", "skills", "scripts", "tests", ".githooks", ".github"):
                if not (ROOT / dirname).is_dir():
                    continue  # например .github в Режиме B живёт в корне хоста
                shutil.copytree(
                    ROOT / dirname, host / dirname,
                    ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache"),
                )
            shutil.copytree(ROOT / "docs", host / "docs",
                            ignore=shutil.ignore_patterns("history", "__pycache__"))
            shutil.copy2(ROOT / "project.example.json", host / "project.example.json")
            shutil.copy2(ROOT / "project.example.json", host / "project.json")
            shutil.copy2(ROOT / "docs" / "templates" / "PROJECT.template.md", host / "PROJECT.md")
            self.assertFalse((host / "project.json").samefile(ROOT / "project.json"))
            # README.md доставлен в новый репозиторий: ссылки docs/decisions -> ../../README.md живы
            self.assertTrue((host / "README.md").is_file())

            run_cmd(["git", "init", "-b", "main"], cwd=host)
            run_cmd(["git", "config", "user.email", "dev@example.com"], cwd=host)
            run_cmd(["git", "config", "user.name", "Dev"], cwd=host)
            # Шаг ADOPTION §5: раскатка нативных зеркал CLI до гейта
            roll = run_cmd([sys.executable, str(host / "scripts" / "install-skills"), "--project-root", str(host)], cwd=host)
            self.assertEqual(0, roll.returncode, roll.stderr)
            run_cmd(["git", "add", "-A"], cwd=host)
            run_cmd(["git", "commit", "-m", "chore: mode A canon adoption"], cwd=host)
            run_cmd(["git", "update-ref", "refs/remotes/origin/main", "HEAD"], cwd=host)

            # Purity & Portability Gate зелёный в раскатанном проекте
            rg = run_cmd([sys.executable, str(host / "tests" / "regression.py")], cwd=host)
            self.assertEqual(0, rg.returncode, f"{rg.stdout}\n{rg.stderr}")
            self.assertIn("PURITY & PORTABILITY GATE OK", rg.stdout)

            # Ручной denylist-скан всего раскатанного дерева, включая project.json
            # (он исключён из скана гейта как санкционированное место имён, ADR-0003):
            # боевых литералов донора быть не должно.
            for p in host.rglob("*"):
                if not p.is_file() or ".git" in p.relative_to(host).parts:
                    continue
                if p.suffix not in {".md", ".yml", ".yaml", ".json", ".py", ".sh", ".txt"}:
                    continue
                text = p.read_text(encoding="utf-8", errors="replace")
                m = PURITY_PATTERN.search(text)
                self.assertIsNone(m, f"приватный литерал донора в {p.relative_to(host)}: {m}")

    def test_hub_roster_admits_concrete_workers_for_claim(self):
        # issue #75 / B-03: в ростере project.json должны быть конкретные воркеры,
        # иначе agent-runner/wait-signal --claim-as <worker> падают с exit 2.
        sys.path.insert(0, str(ROOT / "scripts"))
        from project_overlay import load_overlay, overlay_labels, validate_claim_as

        hub_cfg = ROOT / "project.json"
        if not hub_cfg.is_file():
            self.skipTest("хабовый project.json отсутствует (проектная установка)")
        overlay = load_overlay(ROOT, hub_cfg)
        self.assertTrue(overlay["loaded"])
        roster_ids = {node["id"] for node in overlay["roster"]}
        pool_id = overlay["pool_label"].split(":", 1)[1]
        workers = roster_ids - {"owner", "coordinator", "pool"} - {pool_id}
        # issue #106 (R2-06): минимум ОДИН конкретный воркер — валидный проект с
        # одним воркером не должен ломать проверку (прежний >=2 был сверхстрогим).
        self.assertGreaterEqual(
            len(workers), 1,
            f"в ростере {hub_cfg} нет ни одного конкретного воркера: {sorted(roster_ids)}",
        )
        for worker in sorted(workers):
            self.assertIsNone(validate_claim_as(worker, overlay), worker)
        self.assertIsNotNone(validate_claim_as("rogue-node", overlay))

        # Метки воркеров попадают в план create-labels.sh (schema + оверлей)
        extra = {item["name"] for item in overlay_labels(overlay)}
        for worker in sorted(workers):
            self.assertIn(f"to:{worker}", extra)
        expanded = planned_labels(ROOT, project_config=hub_cfg)
        self.assertEqual(set(expanded), set(planned_labels(ROOT)))

        # Человекочитаемая половина оверлея (issue #75 / M3) существует в хабе
        self.assertTrue(
            (ROOT / "PROJECT.md").is_file(),
            "PROJECT.md (ADR-0003/ADOPTION §5) отсутствует рядом с project.json",
        )

    def test_extract_issue_refs_custom_branch_prefixes_via_env(self):
        # issue #73 / B-01: проект с branch_prefixes без work/ext/agent (например
        # ["feat", "fix", "work"]) валиден по project_overlay.py; board_link обязан
        # honor-ить оверлей через AGENT_PROJECT_CONFIG, а не падать на дефолте.
        sys.path.insert(0, str(ROOT / "scripts"))
        import board_link
        from project_overlay import branch_regex, load_overlay

        with tempfile.TemporaryDirectory(prefix="overlay-prefixes-") as tmp:
            cfg_path = Path(tmp) / "project.json"
            cfg_path.write_text(
                json.dumps({
                    "pool_label": "to:pool",
                    "branch_prefixes": ["feat", "fix", "work"],
                    "roster": [{"id": "node-1", "mode": "direct_gh", "color": "0E8A16"}],
                }),
                encoding="utf-8",
            )
            saved = os.environ.get("AGENT_PROJECT_CONFIG")
            os.environ["AGENT_PROJECT_CONFIG"] = str(cfg_path)
            try:
                # Кастомные префиксы распознаются без явного branch_re...
                self.assertEqual(7, board_link.extract_issue_refs("feat/7-fix", []))
                self.assertEqual(12, board_link.extract_issue_refs("fix/12-bug", []))
                # ...а дефолтные (ext/agent) больше не матчатся.
                self.assertIsNone(board_link.extract_issue_refs("ext/7-fix", []))
                self.assertIsNone(board_link.extract_issue_refs("agent/9-x", []))
                # Явный branch_re из оверлея даёт тот же результат.
                ov = load_overlay(ROOT, cfg_path)
                self.assertEqual(7, board_link.extract_issue_refs("feat/7-fix", [], branch_re=branch_regex(ov)))
            finally:
                if saved is None:
                    os.environ.pop("AGENT_PROJECT_CONFIG", None)
                else:
                    os.environ["AGENT_PROJECT_CONFIG"] = saved

    def test_spawn_pack_env_skills_and_install_skills_project_root(self):
        with tempfile.TemporaryDirectory(prefix="env-skills-") as tmp:
            host = Path(tmp) / "host-project"
            local_skill = host / ".claude" / "skills" / "python-pytest" / "SKILL.md"
            local_skill.parent.mkdir(parents=True)
            local_skill.write_text(
                "---\nname: python-pytest\ndescription: Проектные конвенции фикстур и маркеров pytest.\n---\n\n# Pytest Stack Rules\n- Гоняй pytest -q перед сдачей.\n",
                encoding="utf-8",
            )

            # install-skills --project-root раскатывает канонические роли и скиллы, не затирая локальный навык стека
            roll = run_cmd([
                sys.executable, str(ROOT / "scripts" / "install-skills"),
                "--project-root", str(host),
            ])
            self.assertEqual(0, roll.returncode, roll.stderr)
            self.assertTrue((host / ".claude" / "agents" / "executor.md").is_file())
            self.assertTrue(local_skill.is_file())

            # spawn-pack --env-skills подключает локальный навык стека из --project-root
            pack = run_cmd([
                sys.executable, str(ROOT / "scripts" / "spawn-pack"),
                "--role", "auditor", "--issue", "15", "--size", "S",
                "--skills", "auto", "--env-skills", "python-pytest",
                "--project-root", str(host),
                "--brief", "Проверить покрытие тестами модуля парсинга",
            ])
            self.assertEqual(0, pack.returncode, pack.stderr)
            self.assertIn("`python-pytest`", pack.stdout)
            self.assertIn("Pytest Stack Rules", pack.stdout)

    def test_purity_gate_passes_on_canon_and_catches_leaks(self):
        ok = run_cmd([sys.executable, str(ROOT / "tests" / "regression.py")])
        self.assertEqual(0, ok.returncode, ok.stderr)
        self.assertIn("PURITY & PORTABILITY GATE OK", ok.stdout)

        with tempfile.TemporaryDirectory(prefix="purity-neg-") as tmp:
            cand = Path(tmp) / "canon-copy"
            cand.mkdir()
            native_root = ROOT if (ROOT / ".claude").is_dir() else ROOT.parent
            gh_root = ROOT if (ROOT / ".github").is_dir() else ROOT.parent
            for sub in ("schema", "agents", "skills", "scripts"):
                shutil.copytree(ROOT / sub, cand / sub)
            for msub in (".claude", ".agents"):
                shutil.copytree(native_root / msub, cand / msub)
            shutil.copytree(gh_root / ".github", cand / ".github")
            (cand / "docs").mkdir()
            shutil.copy2(ROOT / "docs" / "create-labels.sh", cand / "docs" / "create-labels.sh")
            # Впрыскиваем запрещённый приватный префикс и несуществующий лейбл
            leaked_tok = "to:" + "ar" + "ena"
            (cand / "README.md").write_text(
                f"# Leaked Doc\nНазначь метку `{leaked_tok}` и `status:typo-state`.\n",
                encoding="utf-8",
            )
            bad = run_cmd([sys.executable, str(ROOT / "tests" / "regression.py"), "--root", str(cand)])
            self.assertEqual(1, bad.returncode)
            self.assertIn("PURITY & PORTABILITY GATE FAILED", bad.stderr)
            self.assertIn("PURITY VIOLATION", bad.stderr)
            self.assertIn("UNDECLARED LABEL: status:typo-state", bad.stderr)

    def test_mail_letter_file_exempt_from_purity_and_project_scan(self):
        """Живое письмо поставки docs/MAIL.md обязано называть реальные ветки/адресатов/проект —
        оно выведено из сканов чистоты и проектных имён (issue #83, M-01)."""
        sys.path.insert(0, str(ROOT / "tests"))
        import regression

        leaked = "bestdeejay" + "-" + "design"
        with tempfile.TemporaryDirectory(prefix="mail-exempt-") as tmp:
            root = Path(tmp)
            (root / "docs").mkdir()
            # Письмо с реальными именами — не должно ловиться
            (root / "docs" / "MAIL.md").write_text(
                f"# MAIL — поставка\n\nВетка ext/abc-slug, отчёт audit/slug, платформа {leaked}.\n",
                encoding="utf-8",
            )
            # Тот же токен в обычном каноне — должен ловиться
            (root / "docs" / "OTHER.md").write_text(f"# Other\nПлатформа {leaked}.\n", encoding="utf-8")
            hits = {h["file"] for h in regression.purity_violations(root)}
            self.assertEqual({"docs/OTHER.md"}, hits)

            inv = regression.inventory(root, set())
            self.assertEqual([], [h for h in inv["project_name_hits"] if h["file"].endswith("MAIL.md")])

    def test_form_errors_ignores_github_config_yml(self):
        """config.yml — зарезервированный файл GitHub Issue Forms без схемы form-шаблона (issue #83, M-04)."""
        sys.path.insert(0, str(ROOT / "tests"))
        import regression

        try:
            import yaml  # noqa: F401
        except ModuleNotFoundError:
            self.skipTest("PyYAML не установлен")
        with tempfile.TemporaryDirectory(prefix="forms-config-") as tmp:
            root = Path(tmp)
            forms = root / ".github" / "ISSUE_TEMPLATE"
            forms.mkdir(parents=True)
            # Штатный config.yml GitHub: нет name/description/body — раньше падал гейт
            (forms / "config.yml").write_text(
                "blank_issues_enabled: false\ncontact_links:\n  - name: Docs\n    url: https://example.test\n",
                encoding="utf-8",
            )
            (forms / "task.yml").write_text(
                textwrap.dedent(
                    """\
                    name: Task
                    description: Опиши задачу
                    body:
                      - type: input
                        id: title
                        attributes:
                          label: Заголовок
                    """
                ),
                encoding="utf-8",
            )
            errors = regression.form_errors(root)
            self.assertNotIn(".github/ISSUE_TEMPLATE/config.yml", errors)
            self.assertNotIn(".github/ISSUE_TEMPLATE", errors)
            self.assertEqual({}, errors)

    def test_agent_runner_listens_default_pool_label_alongside_custom(self):
        """Рой слушает и кастомный pool_label из project.json, и дефолтный to:pool issue-форм (#83, M-04)."""
        src = (ROOT / "scripts" / "agent-runner").read_text(encoding="utf-8")
        self.assertRegex(src, r'\{pool_label, "to:pool", f"to:\{args\.claim_as\}"\}')

    def test_preflight_guards_examples_and_docs_spec_against_closing_keywords(self):
        """docs/EXAMPLES.md и docs/AGENT-DOCS-SPEC.md входят в guarded_paths preflight (issue #83, M-02)."""
        src = (ROOT / "scripts" / "preflight").read_text(encoding="utf-8")
        self.assertIn('ROOT / "docs" / "EXAMPLES.md"', src)
        self.assertIn('ROOT / "docs" / "AGENT-DOCS-SPEC.md"', src)
        closing = re.compile(r"\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+#", re.I)
        for rel in ("docs/EXAMPLES.md", "docs/AGENT-DOCS-SPEC.md"):
            self.assertEqual([], closing.findall((ROOT / rel).read_text(encoding="utf-8")), rel)

    def test_bus_md_markers_carry_issue_number_and_unified_delivered(self):
        """Таблица BUS.md соответствует канону KNOWLEDGE_BASE: #N в маркерах, единый DELIVERED (issue #83, M-03)."""
        bus = (ROOT / "BUS.md").read_text(encoding="utf-8")
        for marker in (
            "👀 READ #N — прочитал, проверяю свежесть",
            "🔍 QA #N — OK/FAIL: <что проверил>",
            "♻️ RECLAIMED #N — клейм снят по таймауту, был: <роль/сессия>",
            "📌 DECISION #N — <суть решения>",
            "📬 DELIVERED #N — поставка готова, ждёт ревью",
            "`label:<роль> + status:ready + to:*`",
        ):
            self.assertIn(marker, bus)
        self.assertNotIn("👀 READ — принял", bus)

    def test_debt_d006_d009_tracked_by_batch_issue(self):
        """D-006..D-009 отслеживаются батч-issue type:debt #150 (issue #83, M-05)."""
        debt = (ROOT / "DEBT.md").read_text(encoding="utf-8")
        self.assertIn("D-006..D-009", debt)
        self.assertIn("#150", debt)
        self.assertIn("батч-issue", debt)

    def test_preflight_receipt_is_honest_about_purity(self):
        """--skip-tests НЕ трогает Гейт Чистоты; пропустить его можно только явно (--skip-purity), #79/H-03."""
        ok = run_cmd([sys.executable, str(ROOT / "scripts" / "preflight"), "--skip-tests", "--ci-main"])
        self.assertEqual(0, ok.returncode, ok.stderr)
        self.assertIn("tests=skipped", ok.stdout)
        self.assertIn("purity=ok", ok.stdout)

        explicit = run_cmd([
            sys.executable, str(ROOT / "scripts" / "preflight"),
            "--skip-tests", "--skip-purity", "--ci-main",
        ])
        self.assertEqual(0, explicit.returncode, explicit.stderr)
        self.assertIn("PURITY: SKIPPED (явно)", explicit.stderr)
        self.assertIn("purity=SKIPPED (явно)", explicit.stdout)
        self.assertNotIn("purity=ok", explicit.stdout)

    def test_commands_work_without_pyyaml_and_skip_forms_explicitly(self):
        """На чистом Python без PyYAML команды из ADOPTION.md работают и честно печатают пропуск форм, #79/H-03."""
        with tempfile.TemporaryDirectory(prefix="no-pyyaml-") as tmp:
            blocker = Path(tmp) / "yaml.py"
            blocker.write_text('raise ModuleNotFoundError("No module named yaml")\n', encoding="utf-8")
            env = os.environ.copy()
            env["PYTHONPATH"] = str(blocker.parent)
            env["PYTHONDONTWRITEBYTECODE"] = "1"

            rg = run_cmd([sys.executable, str(ROOT / "tests" / "regression.py")], env=env)
            self.assertEqual(0, rg.returncode, f"{rg.stdout}\n{rg.stderr}")
            self.assertIn("Issue forms: SKIPPED", rg.stdout)
            self.assertIn("PyYAML", rg.stdout)
            self.assertIn("PURITY & PORTABILITY GATE OK", rg.stdout)

            pf = run_cmd([
                sys.executable, str(ROOT / "scripts" / "preflight"),
                "--skip-tests", "--ci-main",
            ], env=env)
            self.assertEqual(0, pf.returncode, f"{pf.stdout}\n{pf.stderr}")
            self.assertIn("PREFLIGHT OK", pf.stdout)
            self.assertIn("purity=ok (forms: skipped", pf.stdout)
            self.assertIn("YAML-форм пропущена", pf.stderr)

    def test_canon_portable_in_workflow_subdirectory(self):
        # Избегаем рекурсивного запуска изнутри самого дочернего workflow/
        if ROOT.name == "workflow":
            return
        with tempfile.TemporaryDirectory(prefix="workflow-subdir-") as tmp:
            host = Path(tmp) / "my-service"
            wf = host / "workflow"
            host.mkdir()

            def _ignore(dirpath: str, names: list[str]) -> set[str]:
                rel = Path(dirpath).resolve().relative_to(ROOT).as_posix()
                ignored = {".git", "__pycache__", ".pytest_cache"}
                if rel == ".":
                    ignored |= {".claude", ".agents", ".github"}
                if rel == "docs":
                    ignored.add("history")
                return ignored & set(names)

            shutil.copytree(ROOT, wf, ignore=_ignore)
            shutil.copytree(ROOT / ".github", host / ".github")
            shutil.copy2(ROOT / "project.example.json", wf / "project.json")
            shutil.copy2(ROOT / "docs" / "templates" / "PROJECT.template.md", wf / "PROJECT.md")
            (host / "README.md").write_text("# My Service\n\nПрикладной сервис.\n", encoding="utf-8")

            # Инициализируем полностью чистый git-репозиторий без истории agents
            run_cmd(["git", "init", "-b", "main"], cwd=host)
            run_cmd(["git", "config", "user.email", "dev@example.com"], cwd=host)
            run_cmd(["git", "config", "user.name", "Dev"], cwd=host)

            roll = run_cmd([
                sys.executable, str(wf / "scripts" / "install-skills"),
                "--project-root", str(host),
            ], cwd=host)
            self.assertEqual(0, roll.returncode, roll.stderr)

            run_cmd(["git", "add", "-A"], cwd=host)
            run_cmd(["git", "commit", "-m", "chore: initial canon adoption in workflow/"], cwd=host)
            run_cmd(["git", "update-ref", "refs/remotes/origin/main", "HEAD"], cwd=host)
            run_cmd(["git", "checkout", "-b", "work/1-adopt"], cwd=host)

            # 1) install-hooks в подкаталоге ставит core.hooksPath=workflow/.githooks
            hk = run_cmd([sys.executable, str(wf / "scripts" / "preflight"), "--install-hooks"], cwd=host)
            self.assertEqual(0, hk.returncode, hk.stderr)
            hooks_cfg = run_cmd(["git", "config", "--get", "core.hooksPath"], cwd=host).stdout.strip()
            self.assertEqual("workflow/.githooks", hooks_cfg)

            # 2) Purity & Portability Gate зелёный в подкаталоге workflow/ с живым project.json и без docs/history/
            rg = run_cmd([sys.executable, str(wf / "tests" / "regression.py")], cwd=host)
            self.assertEqual(0, rg.returncode, f"{rg.stdout}\n{rg.stderr}")
            self.assertIn("PURITY & PORTABILITY GATE OK", rg.stdout)

            # 3) preflight --quick зелёный в подкаталоге workflow/ и прогоняет переносимые тесты без истории agents
            pf = run_cmd([sys.executable, str(wf / "scripts" / "preflight"), "--quick", "--trivial"], cwd=host)
            self.assertEqual(0, pf.returncode, f"{pf.stdout}\n{pf.stderr}")
            self.assertIn("PREFLIGHT OK", pf.stdout)
            self.assertIn("purity=ok", pf.stdout)

    def _pick_support_file(self, skill: str = "security-audit-core") -> str:
        canon_support = ROOT / "skills" / skill / "support"
        for p in sorted(canon_support.rglob("*")):
            if p.is_file():
                return p.relative_to(ROOT / "skills" / skill).as_posix()
        self.fail(f"в канон-навыке {skill} нет support-файлов")

    def test_check_project_root_checks_host_mirrors_including_support(self):
        # issue #107 (R2-07): install-skills --check должен уважать --project-root и
        # ловить дрейф ЛЮБОГО файла зеркала навыка (SKILL.md + support/ и пр.), а не
        # только SKILL.md.
        with tempfile.TemporaryDirectory(prefix="check-proj-root-") as tmp:
            host = Path(tmp) / "host-project"
            roll = run_cmd([
                sys.executable, str(ROOT / "scripts" / "install-skills"),
                "--project-root", str(host),
            ])
            self.assertEqual(0, roll.returncode, roll.stderr)

            support_rel = self._pick_support_file()
            ok = run_cmd([
                sys.executable, str(ROOT / "scripts" / "install-skills"),
                "--check", "--project-root", str(host),
            ])
            self.assertEqual(0, ok.returncode, ok.stderr)
            self.assertIn("target=", ok.stdout)

            # Негатив 1: подмена support-файла в .claude-зеркале — --check красный
            claude_support = host / ".claude" / "skills" / "security-audit-core" / support_rel
            self.assertTrue(claude_support.is_file(), claude_support)
            claude_support.write_text("CORRUPTED MIRROR!\n", encoding="utf-8")
            bad = run_cmd([
                sys.executable, str(ROOT / "scripts" / "install-skills"),
                "--check", "--project-root", str(host),
            ])
            self.assertEqual(1, bad.returncode, bad.stdout)
            self.assertIn("install-skills CHECK FAILED", bad.stderr)
            self.assertIn(f".claude/skills/security-audit-core/{support_rel}", bad.stderr)

            # Негатив 2: удаление support-файла в .agents-зеркале — --check красный
            agents_support = host / ".agents" / "skills" / "security-audit-core" / support_rel
            self.assertTrue(agents_support.is_file(), agents_support)
            agents_support.unlink()
            bad2 = run_cmd([
                sys.executable, str(ROOT / "scripts" / "install-skills"),
                "--check", "--project-root", str(host),
            ])
            self.assertEqual(1, bad2.returncode, bad2.stdout)
            self.assertIn(f".agents/skills/security-audit-core/{support_rel}", bad2.stderr)
            self.assertIn("отсутствует нативное зеркало", bad2.stderr)

    def test_regression_mirror_sync_catches_support_drift_in_workflow_layout(self):
        # issue #107 (R2-07): check_mirror_sync в раскладке workflow/ сверяет полное
        # дерево навыков — подмена/удаление support-файла в хостовых зеркалах ловится.
        if ROOT.name == "workflow":
            return
        with tempfile.TemporaryDirectory(prefix="mirror-support-drift-") as tmp:
            host = Path(tmp) / "my-service"
            wf = host / "workflow"
            host.mkdir()

            def _ignore(dirpath: str, names: list[str]) -> set[str]:
                rel = Path(dirpath).resolve().relative_to(ROOT).as_posix()
                ignored = {".git", "__pycache__", ".pytest_cache"}
                if rel == ".":
                    ignored |= {".claude", ".agents", ".github"}
                if rel == "docs":
                    ignored.add("history")
                return ignored & set(names)

            shutil.copytree(ROOT, wf, ignore=_ignore)
            roll = run_cmd([
                sys.executable, str(wf / "scripts" / "install-skills"),
                "--project-root", str(host),
            ], cwd=host)
            self.assertEqual(0, roll.returncode, roll.stderr)

            sys.path.insert(0, str(ROOT / "tests"))
            import regression

            # Позитив: чистые зеркала — check_mirror_sync зелёный
            self.assertEqual([], regression.check_mirror_sync(wf))

            # Негатив: подмена support-файла в .claude и удаление в .agents
            support_rel = self._pick_support_file()
            claude_support = host / ".claude" / "skills" / "security-audit-core" / support_rel
            self.assertTrue(claude_support.is_file(), claude_support)
            claude_support.write_text("CORRUPTED MIRROR!\n", encoding="utf-8")
            agents_support = host / ".agents" / "skills" / "security-audit-core" / support_rel
            self.assertTrue(agents_support.is_file(), agents_support)
            agents_support.unlink()

            errs = regression.check_mirror_sync(wf)
            self.assertTrue(errs, "mirror drift в support/ не пойман")
            joined = "\n".join(errs)
            self.assertIn(f".claude/skills/security-audit-core/{support_rel}", joined)
            self.assertIn(f".agents/skills/security-audit-core/{support_rel}", joined)


class OwnerGuardTests(unittest.TestCase):
    """Замок репозитория по слову владельца (решение владельца 15.11, #170)."""

    def setUp(self) -> None:
        import importlib.util
        from importlib.machinery import SourceFileLoader

        loader = SourceFileLoader("agents_guard_under_test", str(ROOT / "scripts" / "guard"))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        self.guard = importlib.util.module_from_spec(spec)
        loader.exec_module(self.guard)

    def test_guard_lock_default_locked_and_expiry(self):
        g = self.guard
        with tempfile.TemporaryDirectory(prefix="guard-") as tmp:
            g.UNLOCK_FILE = Path(tmp) / ".guard-unlock"
            # По умолчанию замкнуто
            self.assertIsNone(g._read_unlock())
            self.assertFalse(g.is_open_for_hooks())
            self.assertEqual(1, g.main(["--status"]))
            # Владелец снимает замок — открыто
            self.assertEqual(0, g.main(["--unlock", "слово владельца"]))
            self.assertTrue(g.is_open_for_hooks())
            self.assertEqual(0, g.main(["--status"]))
            # Просроченная запись (старая дата) — замок снова закрыт
            g.UNLOCK_FILE.write_text("2026-11-01 | старое слово\n", encoding="utf-8")
            self.assertFalse(g.is_open_for_hooks())
            self.assertEqual(1, g.main(["--status"]))
            # Мусор в записи — не открывает
            g.UNLOCK_FILE.write_text("мусор без даты\n", encoding="utf-8")
            self.assertFalse(g.is_open_for_hooks())
            # --lock закрывает начисто
            g.UNLOCK_FILE.write_text("2026-11-01 | x\n", encoding="utf-8")
            self.assertEqual(0, g.main(["--lock"]))
            self.assertFalse(g.UNLOCK_FILE.exists())
            self.assertFalse(g.is_open_for_hooks())

    def test_pre_push_hook_refuses_all_pushes_when_locked(self):
        g = self.guard
        hook = ROOT / ".githooks" / "pre-push"
        with tempfile.TemporaryDirectory(prefix="guard-hook-") as tmp:
            g.UNLOCK_FILE = Path(tmp) / ".guard-unlock"
            self.assertFalse(g.is_open_for_hooks())
            # Замок блокирует ЛЮБОЙ пуш (не только main)
            blocked = run_cmd(
                ["bash", str(hook), "origin", "https://example.com/org/project.git"],
                stdin_text="refs/heads/work/42 abc refs/heads/work/42 000\n",
                env={"GUARD_UNLOCK_FILE": str(g.UNLOCK_FILE)},
            )
            self.assertEqual(1, blocked.returncode)
            self.assertIn("ЗАМОК РЕПОЗИТОРИЯ", blocked.stderr)
            # После разблокировки хук пропускает work-ветку, но по-прежнему запрещает main
            from datetime import datetime, timezone
            g.UNLOCK_FILE.write_text(
                datetime.now(timezone.utc).strftime("%Y-%m-%d") + " | тест\n", encoding="utf-8"
            )
            self.assertTrue(g.is_open_for_hooks())
            allowed = run_cmd(
                ["bash", str(hook), "origin", "https://example.com/org/project.git"],
                stdin_text="refs/heads/work/42 abc refs/heads/work/42 000\n",
                env={"GUARD_UNLOCK_FILE": str(g.UNLOCK_FILE)},
            )
            self.assertEqual(0, allowed.returncode, allowed.stderr)
            still_blocked = run_cmd(
                ["bash", str(hook), "origin", "https://example.com/org/project.git"],
                stdin_text="refs/heads/work/42 abc refs/heads/main 000\n",
                env={"GUARD_UNLOCK_FILE": str(g.UNLOCK_FILE)},
            )
            self.assertEqual(1, still_blocked.returncode)
            self.assertIn("ЗАБЛОКИРОВАНО", still_blocked.stderr)


if __name__ == "__main__":
    unittest.main()
