"""Поведенческие тесты scripts/wait-signal через мок-gh (tests/mock_gh.py).

Без сети: `gh` подменяется исполняемой копией мока в /tmp, состояние и сценарий
передаются через JSON (fixtures: tests/fixtures/json/wait-signal-*.json).
Проверяются коды выхода, stdout-сигналы и эффекты claim (labels, комментарии),
а не текст скрипта: побайтовая сверка с исторической базой зафиксирована в
docs/VALIDATION-2026-11-03.md.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "json"
REPO = "owner/repo"

# имена словаря KNOWLEDGE_BASE §5 в формате --match (эмодзи match_any срезает)
MARKERS = ("DONE", "BLOCKED", "QUESTION", "NEEDS-HUMAN", "DELIVERED", "CONCLUSION",
           "GATE OPEN", "CLAIM", "VERDICT", "RECLAIMED", "LAUNCH")


def now_iso(seconds_ahead=0):
    return (datetime.now(timezone.utc).replace(microsecond=0)
            + __import__("datetime").timedelta(seconds=seconds_ahead)
            ).strftime("%Y-%m-%dT%H:%M:%SZ")


class WaitSignalCase(unittest.TestCase):
    def run_wait(self, state, scenario=None, argv=None, timeout=60, keep=False):
        """keep=True: каталог с состоянием не удаляется (гонки двух претендентов).

        Обычный вызов возвращает (rc, stdout, stderr); с keep=True —
        (rc, stdout, stderr, tmpdir).
        """
        """Копирует mock_gh.py как `gh` в /tmp bin, запускает wait-signal.

        Возвращает (exit_code, stdout, stderr, итоговое состояние мока).
        """
        tmp = Path(tempfile.mkdtemp(prefix="ws-test-"))
        bin_dir = tmp / "bin"
        bin_dir.mkdir()
        gh = bin_dir / "gh"
        shutil.copy(ROOT / "tests" / "mock_gh.py", gh)
        gh.chmod(0o755)
        state_path, scenario_path = tmp / "state.json", tmp / "scenario.json"
        state_path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        scenario_path.write_text(json.dumps(scenario or {}, ensure_ascii=False), encoding="utf-8")
        state_dir = tmp / "etag-cache"
        env = dict(os.environ)
        env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
        env["WS_MOCK_STATE"] = str(state_path)
        env["WS_MOCK_SCENARIO"] = str(scenario_path)
        argv = list(argv or []) + ["--repo", REPO, "--issue", "12", "--state-dir", str(state_dir)]
        try:
            proc = subprocess.run(["bash", str(ROOT / "scripts" / "wait-signal")] + argv,
                                  capture_output=True, text=True, env=env, timeout=timeout)
        finally:
            if not keep:
                shutil.rmtree(tmp, ignore_errors=True)
        if keep:
            return proc.returncode, proc.stdout, proc.stderr, tmp
        return proc.returncode, proc.stdout, proc.stderr

    def base_state(self):
        return {
            "labels": ["status:ready", "agent:coder", "to:sz-2"],
            "updated_at": "2026-11-03T08:00:00Z",
            "body_first": "Задача на поставку",
            "comments": [], "checks": {"total_count": 0, "runs": []},
            "next_id": 101, "calls": 0, "not_modified_served": 0, "fail_left": {},
        }

    def wait_argv(self, extra=None):
        return ["--timeout", "2", "--interval", "1", "--quiet"] + (extra or [])


class MarkerMatchTests(WaitSignalCase):
    def test_dictionary_markers_signal(self):
        for marker in MARKERS:
            with self.subTest(marker=marker):
                state = self.base_state()
                state["comments"] = [{"id": 1, "created_at": now_iso(),
                                      "first": f"🏁 {marker} #12 — сигнал"}]
                rc, out, _ = self.run_wait(state, argv=self.wait_argv(["--match", marker]))
                self.assertEqual(0, rc)
                self.assertIn(f"comment: 🏁 {marker} #12", out)

    def test_negative_variants_do_not_match(self):
        negatives = (("NOTDONE", "DONE"), ("DONEISH", "DONE"), ("DONE2", "DONE"),
                     ("DONE-ish", "DONE"), ("NEEDS-HUMAN-ISH", "NEEDS-HUMAN"),
                     ("CLAIMED-vs-CLAIM", "CLAIM"))
        for text, marker in negatives:
            with self.subTest(text=text):
                state = self.base_state()
                state["comments"] = [{"id": 1, "created_at": now_iso(), "first": text}]
                rc, out, _ = self.run_wait(state, argv=self.wait_argv(["--match", marker, "--timeout", "1"]))
                self.assertEqual(1, rc, text)
                self.assertNotIn("SIGNAL", out)


class PaginationTests(WaitSignalCase):
    def test_101_comments_marker_on_last_page_signals(self):
        fixture = json.loads((FIXTURES / "wait-signal-comments-101.json").read_text(encoding="utf-8"))
        state = self.base_state()
        state["comments"] = fixture["comments"]
        rc, out, _ = self.run_wait(state, argv=self.wait_argv(["--match", "DONE"]))
        self.assertEqual(0, rc)
        self.assertIn("comment: 🏁 DONE #12 — работа принята", out)

    def test_150_checks_all_done_signal(self):
        fixture = json.loads((FIXTURES / "wait-signal-checks-150.json").read_text(encoding="utf-8"))
        state = self.base_state()
        # Запас +60с (было +2с): WAIT_START захватывается скриптом после запуска
        # нескольких подпроцессов (bash, мок-gh auth), и под нагрузкой полного
        # прогона задержка до WAIT_START бывала больше 2с — свежие checks
        # объявлялись «завершёнными до старта ожидания», сигнал терялся, тест
        # падал по таймауту. Семантика не ослаблена: checks по-прежнему обязаны
        # быть завершёнными СТРОГО после старта ожидания скрипта.
        fresh = now_iso(seconds_ahead=60)
        for run in fixture["checks"]["runs"]:
            run["updated_at"] = fresh
        state["checks"] = fixture["checks"]
        argv = ["--timeout", "2", "--interval", "1", "--sha", "abc1234def5678"]
        rc, out, err = self.run_wait(state, argv=argv)
        self.assertEqual(0, rc)
        self.assertIn("ci: ✅ CI #12 — checks: success abc1234", out)
        self.assertIn("CI 150/150 completed", err)

    def test_zero_checks_no_signal(self):
        state = self.base_state()
        state["checks"] = {"total_count": 0, "runs": []}
        rc, out, _ = self.run_wait(state, argv=self.wait_argv(["--sha", "abc1234def5678", "--timeout", "1"]))
        self.assertEqual(1, rc)
        self.assertNotIn("SIGNAL", out)


class RobustnessTests(WaitSignalCase):
    def test_issue_404_exit_2(self):
        rc, _, _ = self.run_wait(self.base_state(), scenario={"issue_404": True},
                                 argv=self.wait_argv())
        self.assertEqual(2, rc)

    def test_temporary_http_failure_keeps_polling(self):
        state = self.base_state()
        state["comments"] = [{"id": 1, "created_at": now_iso(), "first": "🏁 DONE #12"}]
        rc, out, err = self.run_wait(state, scenario={"fail_once": ["comments?per_page"]},
                                     argv=self.wait_argv(["--match", "DONE"]))
        self.assertEqual(0, rc)
        self.assertIn("временный сбой HTTP 502", err)
        self.assertIn("comment: 🏁 DONE", out)

    def test_etag_304_reuses_cached_body(self):
        # Ни сигнала, ни ошибки: повторные поллинги обязаны пройти через 304
        # из кэша; число 304 фиксируется в состоянии мока.
        # --timeout 8 (было 2): ассерт >=3 повторов 304 требует ТРЕТЬЕГО поллинга,
        # а цикл скрипта проверяет дедлайн только ПОСЛЕ очередного поллинга: при
        # timeout=2 третий поллинг попадает в бюджет, только если первые две
        # итерации уместились примерно в 1с — под нагрузкой полного прогона не
        # умещались, счётчик замирал на 2 (измерено: 2 без нагрузки тоже,
        # 2/4 чередуются от запуска к запуску). Бюджет 8с гарантирует третий
        # поллинг вплоть до задержек ~2с на запуск одного мок-gh; измерено
        # 8-12 повторов 304 под нагрузкой. Ассерт не ослаблен.
        tmp = Path(tempfile.mkdtemp(prefix="ws-etag-"))
        try:
            bin_dir = tmp / "bin"
            bin_dir.mkdir()
            gh = bin_dir / "gh"
            shutil.copy(ROOT / "tests" / "mock_gh.py", gh)
            gh.chmod(0o755)
            state_path = tmp / "state.json"
            state_path.write_text(json.dumps(self.base_state()), encoding="utf-8")
            env = dict(os.environ)
            env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
            env["WS_MOCK_STATE"] = str(state_path)
            env["WS_MOCK_SCENARIO"] = str(tmp / "scenario.json")
            argv = ["--repo", REPO, "--issue", "12", "--timeout", "8", "--interval", "1",
                    "--quiet", "--state-dir", str(tmp / "cache")]
            proc = subprocess.run(["bash", str(ROOT / "scripts" / "wait-signal")] + argv,
                                  capture_output=True, text=True, env=env, timeout=30)
            self.assertEqual(1, proc.returncode)
            served_304 = json.loads(state_path.read_text(encoding="utf-8"))["not_modified_served"]
            self.assertGreaterEqual(served_304, 3)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class ClaimTests(WaitSignalCase):
    def claim_argv(self, claim_as="sz-2", claim_id="SZ-2 / сессия 2026-11-03-a"):
        return ["--claim", claim_id, "--claim-as", claim_as]

    def test_claim_free_task_roundtrip(self):
        tmp = Path(tempfile.mkdtemp(prefix="ws-claim-"))
        try:
            bin_dir = tmp / "bin"
            bin_dir.mkdir()
            gh = bin_dir / "gh"
            shutil.copy(ROOT / "tests" / "mock_gh.py", gh)
            gh.chmod(0o755)
            state_path = tmp / "state.json"
            state_path.write_text(json.dumps(self.base_state()), encoding="utf-8")
            scenario_path = tmp / "scenario.json"
            scenario_path.write_text("{}", encoding="utf-8")
            env = dict(os.environ)
            env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
            env["WS_MOCK_STATE"] = str(state_path)
            env["WS_MOCK_SCENARIO"] = str(scenario_path)
            argv = ["--repo", REPO, "--issue", "12", "--state-dir", str(tmp / "cache"),
                    "--claim", "SZ-2 / сессия 2026-11-03-a", "--claim-as", "sz-2"]
            proc = subprocess.run(["bash", str(ROOT / "scripts" / "wait-signal")] + argv,
                                  capture_output=True, text=True, env=env, timeout=60)
            self.assertEqual(0, proc.returncode, proc.stderr)
            self.assertIn("CLAIMED", proc.stdout)
            final = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(["status:in-progress", "agent:coder", "to:sz-2"], final["labels"])
            self.assertEqual(1, len([c for c in final["comments"]
                                     if c["first"].startswith("✋ CLAIM")]))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_claim_busy_on_foreign_claim(self):
        state = self.base_state()
        state["comments"] = [{"id": 5, "created_at": now_iso(),
                              "first": "✋ CLAIM #12 — взял: SZ-1 / другая сессия"}]
        rc, out, _ = self.run_wait(state, argv=self.claim_argv())
        self.assertEqual(3, rc)
        self.assertIn("BUSY: есть claim", out)

    def test_claim_in_progress_with_reclaimed_reports_possible_free(self):
        state = self.base_state()
        state["labels"] = ["status:in-progress", "to:sz-1"]
        state["comments"] = [{"id": 5, "created_at": now_iso(), "first": "♻️ RECLAIMED #12"}]
        rc, out, _ = self.run_wait(state, argv=self.claim_argv())
        self.assertEqual(3, rc)
        self.assertIn("RECLAIMED", out)

    def test_claim_resume_own_unfinished_claim(self):
        header = "✋ CLAIM #12 — взял: SZ-2 / сессия 2026-11-03-a"
        state = self.base_state()
        state["comments"] = [{"id": 5, "created_at": now_iso(), "first": header}]
        rc, out, err = self.run_wait(state, argv=self.claim_argv())
        self.assertEqual(0, rc, err)
        self.assertIn("RESUME", err)
        self.assertIn("CLAIMED", out)

    def test_claim_freed_by_newer_reclaim(self):
        # ready + чужой CLAIM + более свежий RECLAIMED — задача свободна: CLAIMED.
        state = self.base_state()
        state["comments"] = [
            {"id": 5, "created_at": "2026-11-03T09:00:00Z",
             "first": "✋ CLAIM #12 — взял: SZ-1 / старая попытка"},
            {"id": 6, "created_at": "2026-11-03T10:00:00Z",
             "first": "♻️ RECLAIMED #12 — задача освобождена, координатор вернул в ready"},
        ]
        rc, out, err = self.run_wait(state, argv=self.claim_argv())
        self.assertEqual(0, rc, err)
        self.assertIn("CLAIMED", out)
        self.assertIn("задача свободна, продолжаю claim", err)

    def test_claim_busy_when_claim_fresher_than_reclaim(self):
        # CLAIM свежее RECLAIMED — прежний BUSY exit 3.
        state = self.base_state()
        state["comments"] = [
            {"id": 5, "created_at": "2026-11-03T09:00:00Z",
             "first": "♻️ RECLAIMED #12 — освобождена"},
            {"id": 6, "created_at": "2026-11-03T10:00:00Z",
             "first": "✋ CLAIM #12 — взял: SZ-1 / актуальная попытка"},
        ]
        rc, out, _ = self.run_wait(state, argv=self.claim_argv())
        self.assertEqual(3, rc)
        self.assertIn("BUSY: есть claim", out)

    def test_two_pretenders_one_claimed_other_lost(self):
        # Гонка: наш претендент получает LOST (чужой claim старше), после чего
        # второй запуск на том же состоянии фиксирует CLAIMED за победителем.
        state = self.base_state()
        scenario = {"race": {"on_query": 3,
                             "created_at": "2026-11-03T00:00:00Z",
                             "first": "✋ CLAIM #12 — взял: SZ-1 / competitor"}}
        rc, out, err, tmp = self.run_wait(state, scenario=scenario,
                                        argv=self.claim_argv("sz-2", "SZ-2 / гонка"), keep=True)
        try:
            self.assertEqual(3, rc)
            self.assertIn("LOST", out)  # LOST печатается в stdout, как BUSY/CLAIMED
            state_path = tmp / "state.json"
            # второй претендент (победитель) повторно забирает на том же состоянии:
            # его собственный claim — самый ранний живой, RESUME -> CLAIMED
            env_cmd = ["bash", str(ROOT / "scripts" / "wait-signal"),
                       "--repo", REPO, "--issue", "12",
                       "--state-dir", str(tmp / "cache"),
                       "--claim", "SZ-1 / competitor", "--claim-as", "sz-1"]
            bin_dir = tmp / "bin"
            env = dict(os.environ)
            env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
            env["WS_MOCK_STATE"] = str(state_path)
            env["WS_MOCK_SCENARIO"] = str(tmp / "scenario.json")
            proc = subprocess.run(env_cmd, capture_output=True, text=True,
                                  env=env, timeout=60)
            self.assertEqual(0, proc.returncode, proc.stderr)
            self.assertIn("CLAIMED", proc.stdout)
            final = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertIn("status:in-progress", final["labels"])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_claim_lost_in_race_to_earlier_foreign_claim(self):
        state = self.base_state()
        scenario = {"race": {"on_query": 3,
                             "created_at": "2026-11-03T00:00:00Z",
                             "first": "✋ CLAIM #12 — взял: SZ-1 / competitor"}}
        rc, out, _ = self.run_wait(state, scenario=scenario, argv=self.claim_argv())
        self.assertEqual(3, rc)
        self.assertIn("LOST", out)


if __name__ == "__main__":
    unittest.main()
