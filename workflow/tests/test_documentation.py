from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

try:
    import yaml
except ModuleNotFoundError:  # PyYAML опционален: нужен только для YAML-форм/фронтматтеров (issue #79, H-03)
    yaml = None
HAS_YAML = yaml is not None

from check_core_labels import planned_labels
from regression import form_errors, inventory

ROOT = Path(__file__).resolve().parents[1]

requires_yaml = unittest.skipUnless(HAS_YAML, "PyYAML не установлен (python3 -m pip install -r tests/requirements.txt)")


def text(path: str) -> str:
    p = ROOT / path
    if not p.is_file() and path.startswith(".github/") and (ROOT.parent / path).is_file():
        p = ROOT.parent / path
    return p.read_text(encoding="utf-8")


def form(path: str) -> dict:
    return yaml.safe_load(text(path))


def item(doc: dict, element_id: str) -> dict:
    return next(element for element in doc["body"] if element.get("id") == element_id)


class DocumentationTests(unittest.TestCase):
    def test_approved_owner_decisions_preserved(self):
        """Decisions 1–13 remain explicitly documented in docs/README.md without hardcoded fleet names."""
        readme = text("docs/README.md")
        for number in range(1, 14):
            pattern = rf"^\| {number} \|.*$"
            self.assertIsNotNone(re.search(pattern, readme, re.M), f"missing decision row {number}")
        self.assertIn("Labels в issues — канон, GitHub Projects — только вид", readme)
        self.assertIn("Пуш своей ветки после каждой задачи", readme)
        self.assertIn("ADR-0003", readme)

    def test_three_role_headers_reflect_approval(self):
        for name in ("AGENT_RULES", "COORDINATOR_RULES", "KNOWLEDGE_BASE"):
            header = text(f"docs/{name}.md").splitlines()[:8]
            self.assertTrue(any("утверждён владельцем 03.11.2026" in line for line in header), name)
            self.assertFalse(any("на ревью и утверждении" in line for line in header), name)

    def test_labels_are_the_source_and_coordinator_handles_normal_transitions(self):
        board = text("BOARD.md")
        self.assertIn("label `status:*` в issue; карточка борда — вид", board)
        knowledge = text("docs/KNOWLEDGE_BASE.md")
        self.assertIn("Переходы выполняет координатор", knowledge)
        self.assertIn("Просит координатора", knowledge)
        question = text(".github/ISSUE_TEMPLATE/question.yml")
        self.assertIn("попроси координатора", question)

    def test_adr_exception_does_not_open_action_gate(self):
        executor = text("docs/AGENT_RULES.md")
        coordinator = text("docs/COORDINATOR_RULES.md")
        self.assertIn("разрешено подготовить в своей ветке предписанный `proposed` ADR", executor)
        self.assertIn("не разрешение начинать ACTION или менять другие файлы", executor)
        self.assertIn("утверждает ADR (`accepted`) и открывает ACTION тем же", executor)
        self.assertIn("`proposed` ADR как `accepted`", coordinator)

    @requires_yaml
    def test_both_issue_forms_parse_and_pass_checked_schema_subset(self):
        self.assertEqual({}, form_errors(ROOT))
        self.assertEqual("checkboxes", item(form(".github/ISSUE_TEMPLATE/task.yml"), "external")["type"])

    @requires_yaml
    def test_issue_forms_match_portable_core_schema(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        from project_overlay import load_overlay, overlay_labels

        schema = json.loads(text("schema/bus.json"))
        core_to = [entry["name"] for entry in schema["label_groups"]["to"]["values"]]
        self.assertEqual(["to:owner", "to:coordinator", "to:pool"], core_to)
        allowed_to = set(core_to) | {x["name"] for x in overlay_labels(load_overlay(ROOT))}
        task_doc = form(".github/ISSUE_TEMPLATE/task.yml")
        q_doc = form(".github/ISSUE_TEMPLATE/question.yml")
        task_opts = set(item(task_doc, "addressee")["attributes"]["options"])
        q_opts = set(item(q_doc, "addressee")["attributes"]["options"])
        self.assertTrue(set(core_to).issubset(task_opts) and task_opts.issubset(allowed_to))
        self.assertTrue(set(core_to).issubset(q_opts) and q_opts.issubset(allowed_to))
        self.assertIn("без автозакрытия", item(task_doc, "output")["attributes"]["placeholder"])

    def test_all_46_core_labels_present_in_recorded_snapshot(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        from project_overlay import load_overlay, overlay_labels

        planned = planned_labels(ROOT)
        snapshot = json.loads(text("tests/fixtures/labels-core.json"))
        core_names = {entry["name"] for entry in snapshot}
        overlay_names = {item["name"] for item in overlay_labels(load_overlay(ROOT))}
        self.assertEqual(46, len(core_names))
        self.assertEqual(len(planned), len(set(planned)))
        self.assertEqual(core_names | overlay_names, set(planned))

    def test_active_templates_do_not_close_tasks_automatically(self):
        paths = (".github/ISSUE_TEMPLATE/task.yml", "docs/AGENT_RULES.md",
                 "docs/COORDINATOR_RULES.md", "docs/PROJECTS-BLUEPRINT.md",
                 "docs/templates/pull_request_template.md")
        closing = re.compile(r"\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+#", re.I)
        for path in paths:
            self.assertNotRegex(text(path), closing, path)
        self.assertIn("без автоматического закрытия", text("docs/templates/pull_request_template.md"))

    def test_root_installation_resolves_template_routes(self):
        """ADOPTION §5 режим A: единственная точка входа — корневой AGENTS.md канона (issue #87)."""
        self.assertFalse((ROOT / "docs" / "AGENTS.md").exists(),
                         "docs/AGENTS.md удалён: корневой AGENTS.md — единственная точка входа")
        with tempfile.TemporaryDirectory(prefix="agent-template-") as directory:
            project = Path(directory)
            shutil.copy2(ROOT / "AGENTS.md", project / "AGENTS.md")
            shutil.copytree(ROOT / "docs", project / "docs", ignore=shutil.ignore_patterns("history"))
            for name in ("STATUS.md", "PROTOCOL.md", "WORKFLOW.md", "BOARD.md", "BUS.md",
                         "OPS.md", "DEBT.md", "agents", "skills", "schema"):
                source = ROOT / name
                if source.is_dir():
                    shutil.copytree(source, project / name)
                elif source.is_file():
                    shutil.copy2(source, project / name)
            installed = (project / "AGENTS.md").read_text(encoding="utf-8")
            self.assertEqual(text("AGENTS.md"), installed)
            routes = set(re.findall(r"\]\(\.?/([^)#]+)\)", installed))
            self.assertTrue(routes, "root AGENTS.md must declare relative routes")
            for route in routes:
                self.assertTrue((project / route).is_file(), route)

    def test_adoption_requires_preserving_existing_work(self):
        adoption = text("docs/ADOPTION.md")
        self.assertIn("Не перезаписывай", adoption)
        self.assertIn("входящие ревью", adoption)
        self.assertIn("временные", adoption)
        self.assertIn("не отменяет решение № 9", adoption)
        self.assertIn("не требование трёх физических стендов", adoption)

    def test_scripts_pass_bash_syntax_and_no_hardcoded_fleet(self):
        for path in ("docs/create-labels.sh", "docs/project-apply.sh", "scripts/wait-signal"):
            with self.subTest(path=path):
                res = subprocess.run(["bash", "-n", str(ROOT / path)], capture_output=True, text=True)
                self.assertEqual(0, res.returncode, res.stderr)

    def test_field_lessons_generalized_and_history_archived(self):
        self.assertTrue((ROOT / "docs" / "FIELD-LESSONS.md").is_file())
        self.assertEqual([], [p.name for p in (ROOT / "docs").glob("FIELD-LESSONS-*.md")])
        self.assertFalse((ROOT / "reference-workflow-source.txt").exists())
        history_dir = ROOT / "docs" / "history"
        if history_dir.is_dir():
            for name in ("README.md", "AUDIT.md", "AUDIT-V2.md", "WORKFLOW-VARIANTS.md",
                         "TEST-REPORT.md", "TEST-REPORT-V2.md", "TEST-REPORT-V3.md",
                         "reference-workflow-source.txt"):
                self.assertTrue((history_dir / name).is_file(), name)

    def test_partial_markdown_link_scan(self):
        self.assertEqual([], inventory(ROOT, set())["broken_links"])

    def test_independence_cannot_be_self_claimed(self):
        self.assertIn("Собственная проверка не выдаётся за чужое ревью", text("PROTOCOL.md"))
        evidence = text("docs/EVIDENCE_RESEARCH.md")
        self.assertIn("Самопроверку не называй независимым ревью", evidence)
        self.assertIn("ревьювер поставки — не её автор", evidence)

    def test_research_has_sources_and_nist_limit_when_archive_present(self):
        research_path = ROOT / "docs" / "history" / "RESEARCH-2026-11-03.md"
        if not research_path.is_file():
            return
        research = research_path.read_text(encoding="utf-8")
        for domain in ("anthropic.com", "openai.com", "docs.github.com", "langchain.com"):
            self.assertIn(domain, research)
        self.assertIn("не подтверждено", research)


if __name__ == "__main__":
    unittest.main()
