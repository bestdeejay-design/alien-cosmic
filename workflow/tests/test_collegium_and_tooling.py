from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

import yaml

from check_core_labels import planned_labels

ROOT = Path(__file__).resolve().parents[1]


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
        labels = [
            entry["name"]
            for grp in self.schema["label_groups"].values()
            for entry in grp["values"]
        ]
        self.assertEqual(52, len(labels))
        self.assertEqual(52, len(set(labels)))
        self.assertEqual(set(planned_labels(ROOT)), set(labels))

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

    def test_root_agents_and_skills_stay_compact_and_valid(self):
        agents_lines = (ROOT / "AGENTS.md").read_text(encoding="utf-8").splitlines()
        self.assertLessEqual(len(agents_lines), 60)

        skill_files = sorted((ROOT / "skills").glob("*/SKILL.md"))
        self.assertEqual(11, len(skill_files))
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
            "subagent-collegium",
            "ui-render-verification",
        }
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

    def test_native_cli_agents_and_skills_mirrored_and_valid(self):
        # 1. Нативные ролевые карточки .claude/agents/*.md валидны для Claude Code / ZCode
        for role in ("auditor", "researcher", "executor", "reviewer"):
            native_agent = ROOT / ".claude" / "agents" / f"{role}.md"
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

        # 2. install-skills --check подтверждает нулевой рассинхрон .claude/ и .agents/
        chk = run_cmd([sys.executable, str(ROOT / "scripts" / "install-skills"), "--check"])
        self.assertEqual(0, chk.returncode, chk.stderr)
        self.assertIn("install-skills OK", chk.stdout)

        # 3. Новые карточки и навыки не вводят несуществующих префиксных лейблов
        from regression import LABEL, PROJECT_PATTERN

        core_set = set(planned_labels(ROOT))
        for folder in ("agents", "skills", ".claude", ".agents"):
            for md in sorted((ROOT / folder).rglob("*.md")):
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

    def test_debt_42_and_incident_41_synced(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        board = (ROOT / "BOARD.md").read_text(encoding="utf-8")
        debt = (ROOT / "DEBT.md").read_text(encoding="utf-8")
        mail = (ROOT / "docs" / "MAIL.md").read_text(encoding="utf-8")
        adr2 = (ROOT / "docs" / "decisions" / "2026-11-06-subagent-collegium-and-enforcement.md").read_text(encoding="utf-8")
        preflight_src = (ROOT / "scripts" / "preflight").read_text(encoding="utf-8")
        hygiene_src = (ROOT / ".github" / "workflows" / "bus-hygiene.yml").read_text(encoding="utf-8")

        self.assertIn("ADR-0001", readme)
        self.assertIn(".githooks/pre-push", readme)
        self.assertIn("guard-main.yml", readme)
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

        # Миноры ревью закрыты: нет /tmp/agents-pyyaml в preflight, пагинация в bus-hygiene, нейтральный MAIL.md
        self.assertNotIn("/tmp/agents-pyyaml", preflight_src)
        self.assertIn("--paginate", hygiene_src)
        self.assertTrue(mail.startswith("# MAIL —"))
        self.assertIn("arena/<hash>-<slug>", mail)


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
        hook = str(ROOT / ".githooks" / "pre-push")
        blocked = run_cmd(
            ["bash", hook, "origin", "https://github.com/bestdeejay-design/agents.git"],
            stdin_text="refs/heads/work/42 abcdef1234567 refs/heads/main 0000000000000\n",
        )
        self.assertEqual(1, blocked.returncode)
        self.assertIn("ЗАБЛОКИРОВАНО", blocked.stderr)

        allowed = run_cmd(
            ["bash", hook, "origin", "https://github.com/bestdeejay-design/agents.git"],
            stdin_text="refs/heads/arena/f00268e7-agents abcdef1234567 refs/heads/arena/f00268e7-agents 0000000000000\n",
        )
        self.assertEqual(0, allowed.returncode, allowed.stderr)

    def test_github_workflows_parse_and_define_permissions(self):
        wf_dir = ROOT / ".github" / "workflows"
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

            # Позитив: радиус покрывает файл-пробник.
            wide = run_cmd([
                sys.executable, str(ROOT / "scripts" / "preflight"),
                "--skip-tests", "--ci-main", "--allow", "tmp-radius-probe.txt,tests/",
            ])
            self.assertEqual(0, wide.returncode, wide.stderr)
            self.assertIn("PREFLIGHT OK", wide.stdout)
        finally:
            run_cmd(["git", "reset", "--", str(probe)])
            probe.unlink(missing_ok=True)
        # Cleanup не оставляет артефактов: пробник удалён, индекс пуст.
        status = run_cmd(["git", "status", "--porcelain"]).stdout
        self.assertNotIn("tmp-radius-probe", status)
        self.assertEqual("", run_cmd(["git", "diff", "--cached", "--name-only"]).stdout)

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
                              "labels": [{{"name": "status:ready"}}, {{"name": "to:sz-pool"}}, {{"name": "agent:coder"}}]}},
                            # 3) Валидный кандидат с закрытой зависимостью #98 — должен пройти!
                            {{"number": 44, "title": "Valid ready task", "body": "Depends on: #98",
                              "labels": [{{"name": "status:ready"}}, {{"name": "to:sz-pool"}}, {{"name": "agent:coder"}}, {{"name": "size:S"}}]}},
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
            env["PATH"] = f"{bin_dir}:{env.get('PATH', '')}"
            state_dir = tmp_path / "etag"

            # Первый сухой прогон (200 OK, сохраняет ETag)
            r1 = run_cmd([
                sys.executable, str(ROOT / "scripts" / "agent-runner"),
                "--repo", "owner/repo", "--agent", "coder", "--claim-as", "sz-1",
                "--state-dir", str(state_dir), "--dry-run",
            ], env=env)
            self.assertEqual(0, r1.returncode, r1.stderr)
            payload1 = json.loads(r1.stdout)
            self.assertEqual([44], [x["number"] for x in payload1["eligible"]])

            # Повторный прогон (идёт через If-None-Match -> 304 Not Modified -> кэш!)
            r2 = run_cmd([
                sys.executable, str(ROOT / "scripts" / "agent-runner"),
                "--repo", "owner/repo", "--agent", "coder", "--claim-as", "sz-1",
                "--state-dir", str(state_dir), "--dry-run",
            ], env=env)
            self.assertEqual(0, r2.returncode, r2.stderr)
            payload2 = json.loads(r2.stdout)
            self.assertEqual([44], [x["number"] for x in payload2["eligible"]])
            self.assertIn("If-None-Match:", calls_log.read_text(encoding="utf-8"))

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


if __name__ == "__main__":
    unittest.main()
