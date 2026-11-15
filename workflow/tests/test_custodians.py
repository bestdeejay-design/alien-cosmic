"""Пилот custodians (#127): схема оверлея, единый вход scripts/custodian, правило R2-02.

Без сети и без реального GitHub: check-команды ролей в тестах — нейтральные shell-команды,
регрессия канона считается на временном корне через функции tests/regression.py.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
CUSTODIAN = SCRIPTS / "custodian"

if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from project_overlay import load_overlay, validate_and_normalize  # noqa: E402
from regression import pilots_violations  # noqa: E402


def write_cfg(directory: Path, custodians: object, **extra) -> Path:
    cfg = {
        "schema_version": "1.0",
        "project": {"slug": "example", "repo": "org/example", "canon_prefix": ""},
        "custodians": custodians,
    }
    cfg.update(extra)
    path = directory / "project.json"
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
    return path


VALID = [
    {"id": "watcher-schema", "kind": "schema-sentinel", "check": "python3 tests/check_core_labels.py --labels-json x.json --report-extra", "cadence": "ежечасно"},
    {"id": "watcher-board", "kind": "board-gardener", "check": "python3 scripts/board_link.py --hygiene", "cadence": "6ч"},
    {"id": "watcher-docs", "kind": "doc-linter", "check": "python3 tests/regression.py"},
]


class CustodianSchemaTest(unittest.TestCase):
    def test_valid_custodians_pass_validation(self):
        out = validate_and_normalize({"custodians": VALID})
        self.assertEqual(len(out["custodians"]), 3)
        self.assertEqual(out["custodians"][0]["id"], "watcher-schema")
        self.assertEqual(out["custodians"][2]["cadence"], "")

    def test_example_overlay_custodians_are_neutral_and_valid(self):
        raw = json.loads((ROOT / "project.example.json").read_text())
        self.assertEqual(len(raw["custodians"]), 3)
        overlay = load_overlay(ROOT, ROOT / "project.example.json")
        self.assertEqual({c["kind"] for c in overlay["custodians"]},
                         {"schema-sentinel", "board-gardener", "doc-linter"})

    def test_duplicate_id_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            cfg = write_cfg(Path(d), VALID + [dict(VALID[0])])
            with self.assertRaisesRegex(ValueError, "дублирующийся id роли"):
                load_overlay(ROOT, cfg)

    def test_unknown_kind_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            cfg = write_cfg(Path(d), [{"id": "x", "kind": "mirror-sentinel", "check": "true"}])
            with self.assertRaisesRegex(ValueError, "kind"):
                load_overlay(ROOT, cfg)

    def test_empty_check_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            cfg = write_cfg(Path(d), [{"id": "x", "kind": "doc-linter", "check": "  "}])
            with self.assertRaisesRegex(ValueError, "check"):
                load_overlay(ROOT, cfg)

    def test_bad_id_and_non_list_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError, "id"):
                load_overlay(ROOT, write_cfg(Path(d), [{"id": "Bad Id!", "kind": "doc-linter", "check": "true"}]))
            with self.assertRaisesRegex(ValueError, "списком"):
                load_overlay(ROOT, write_cfg(Path(d), {"id": "x"}))


def run_custodian(*flags: str, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(CUSTODIAN), *flags],
        cwd=str(cwd or ROOT), text=True, capture_output=True, timeout=120,
    )


class CustodianScriptTest(unittest.TestCase):
    """scripts/custodian --once на fixture-оверлее с нейтральными check-командами."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="custodian-test-"))
        self.state = self.tmp / "state.json"
        self.signal = self.tmp / "signal.txt"
        self.signal.write_text("v1", encoding="utf-8")
        self.cfg = write_cfg(self.tmp, [
            {"id": "watch-docs", "kind": "doc-linter", "check": f"cat {self.signal}"},
        ])
        self.root = self.tmp / "canon"
        self.root.mkdir()
        (self.root / "scripts").mkdir()

    def tearDown(self):
        subprocess.run(["rm", "-rf", str(self.tmp)], check=False)

    def test_first_run_is_quiet_baseline(self):
        res = run_custodian("--once", "--project-config", str(self.cfg), "--state", str(self.state), cwd=self.root)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertNotIn("👤 NEEDS-HUMAN", res.stdout)
        self.assertIn("базлайн", res.stdout)
        self.assertTrue(self.state.is_file())

    def test_unchanged_second_run_does_not_repeat_marker(self):
        run_custodian("--once", "--project-config", str(self.cfg), "--state", str(self.state), cwd=self.root)
        res = run_custodian("--once", "--project-config", str(self.cfg), "--state", str(self.state), cwd=self.root)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertNotIn("👤 NEEDS-HUMAN", res.stdout)
        self.assertIn("ok", res.stdout)

    def test_new_drift_prints_needs_human_marker(self):
        run_custodian("--once", "--project-config", str(self.cfg), "--state", str(self.state), cwd=self.root)
        self.signal.write_text("v2 — drift", encoding="utf-8")
        res = run_custodian("--once", "--project-config", str(self.cfg), "--state", str(self.state), cwd=self.root)
        self.assertEqual(res.returncode, 1)
        self.assertIn("👤 NEEDS-HUMAN", res.stdout)
        self.assertIn("watch-docs", res.stdout)
        self.assertIn("-v1", res.stdout)
        # Третий прогон без новых изменений — маркер не повторяется (state обновился).
        res2 = run_custodian("--once", "--project-config", str(self.cfg), "--state", str(self.state), cwd=self.root)
        self.assertEqual(res2.returncode, 0)
        self.assertNotIn("👤 NEEDS-HUMAN", res2.stdout)

    def test_failing_check_is_drift_too(self):
        fail_cfg = write_cfg(self.tmp, [
            {"id": "watch-fail", "kind": "board-gardener", "check": "exit 3"},
        ])
        run_custodian("--once", "--project-config", str(fail_cfg), "--state", str(self.state), cwd=self.root)
        res = run_custodian("--once", "--project-config", str(fail_cfg), "--state", str(self.state), cwd=self.root)
        self.assertEqual(res.returncode, 0)
        changed = write_cfg(self.tmp, [
            {"id": "watch-fail", "kind": "board-gardener", "check": "exit 0"},
        ])
        res2 = run_custodian("--once", "--project-config", str(changed), "--state", str(self.state), cwd=self.root)
        self.assertEqual(res2.returncode, 1)
        self.assertIn("👤 NEEDS-HUMAN", res2.stdout)

    def test_list_mode(self):
        res = run_custodian("--list", "--project-config", str(self.cfg), cwd=self.root)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("watch-docs\tdoc-linter", res.stdout)

    def test_no_custodians_is_noop(self):
        empty = write_cfg(self.tmp, [])
        res = run_custodian("--once", "--project-config", str(empty), "--state", str(self.state), cwd=self.root)
        self.assertEqual(res.returncode, 0)
        self.assertIn("не объявлены", res.stdout)

    def test_example_overlay_is_valid_and_listed(self):
        res = run_custodian("--list", "--project-config", str(ROOT / "project.example.json"), cwd=str(ROOT))
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("schema-sentinel", res.stdout)


class PilotsRuleTest(unittest.TestCase):
    """R2-02: правило «нет новых pilots/<имя>/ в живом каноне» (regression.py)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pilots-rule-"))
        (self.tmp / "tests").mkdir()

    def tearDown(self):
        subprocess.run(["rm", "-rf", str(self.tmp)], check=False)

    def write_baseline(self, names: list[str]):
        (self.tmp / "tests" / "pilots_baseline.json").write_text(
            json.dumps({"allow": names}), encoding="utf-8")

    def test_baseline_dir_is_allowed(self):
        (self.tmp / "skills" / "x" / "support" / "pilots" / "lovii").mkdir(parents=True)
        self.write_baseline(["lovii"])
        self.assertEqual(pilots_violations(self.tmp), [])

    def test_new_pilots_dir_is_flagged_as_r2_02(self):
        (self.tmp / "skills" / "x" / "support" / "pilots" / "lovii").mkdir(parents=True)
        (self.tmp / "skills" / "x" / "support" / "pilots" / "fresh-pilot").mkdir(parents=True)
        self.write_baseline(["lovii"])
        hits = pilots_violations(self.tmp)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["token"], "R2-02")
        self.assertIn("fresh-pilot", hits[0]["file"])

    def test_history_and_mirrors_are_ignored(self):
        for base in ("docs/history", ".claude/skills/x", ".agents/skills/x"):
            (self.tmp / base / "pilots" / "new-guy").mkdir(parents=True)
        self.write_baseline([])
        self.assertEqual(pilots_violations(self.tmp), [])

    def test_missing_baseline_flags_everything(self):
        (self.tmp / "skills" / "x" / "pilots" / "lovii").mkdir(parents=True)
        hits = pilots_violations(self.tmp)
        self.assertEqual([h["file"].endswith("/lovii") for h in hits], [True])


class RegressionGateIncludesPilotsTest(unittest.TestCase):
    def test_live_canon_pilots_rule_is_green(self):
        self.assertEqual(pilots_violations(ROOT), [],
                         "в живом каноне появились новые pilots/<имя>/ вне baseline")


class CustodianStateNotScannedTest(unittest.TestCase):
    """State-файл custodian (рантайм, в .gitignore) не попадает в скан чистоты (#127)."""

    def test_state_file_is_excluded_from_live_canon_scan(self):
        from regression import live_canon_files
        with tempfile.TemporaryDirectory(prefix="state-scan-") as d:
            root = Path(d)
            (root / ".custodian-state.json").write_text('{"x": "to:worker-1"}', encoding="utf-8")
            self.assertEqual(live_canon_files(root), [])

    def test_live_root_state_file_does_not_trip_purity(self):
        from regression import purity_violations
        # В живом корне state-файл существует после custodian --once и содержит
        # реальные имена узлов — скан обязан остаться зелёным.
        self.assertEqual(
            [h for h in purity_violations(ROOT) if h["file"] == ".custodian-state.json"], [])


if __name__ == "__main__":
    unittest.main()
