from __future__ import annotations

import copy
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

from check_core_labels import planned_labels
from regression import form_errors, inventory

ROOT = Path(__file__).resolve().parents[1]
BASE = "fedec3b8702f71ab89c10294158858b5f7c5520e"


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def at_base(path: str) -> str:
    return subprocess.check_output(["git", "show", f"{BASE}:{path}"], cwd=ROOT, text=True)


def form(path: str) -> dict:
    return yaml.safe_load(text(path))


def item(doc: dict, element_id: str) -> dict:
    return next(element for element in doc["body"] if element.get("id") == element_id)


class DocumentationTests(unittest.TestCase):
    def test_approved_owner_decisions_preserved(self):
        """Decisions 2–9 remain exactly as they were in the approved base."""
        before, after = at_base("docs/README.md"), text("docs/README.md")
        for number in range(2, 10):
            pattern = rf"^\| {number} \|.*$"
            self.assertEqual(re.search(pattern, before, re.M).group(),
                             re.search(pattern, after, re.M).group())

    def test_four_role_headers_reflect_approval(self):
        for name in ("AGENTS", "AGENT_RULES", "COORDINATOR_RULES", "KNOWLEDGE_BASE"):
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

    def test_both_issue_forms_parse_and_pass_checked_schema_subset(self):
        self.assertEqual({}, form_errors(ROOT))
        self.assertEqual("checkboxes", item(form(".github/ISSUE_TEMPLATE/task.yml"), "external")["type"])

    def test_issue_form_changes_are_limited(self):
        old = yaml.safe_load(at_base(".github/ISSUE_TEMPLATE/task.yml"))
        new = form(".github/ISSUE_TEMPLATE/task.yml")
        expected = copy.deepcopy(old)
        item(expected, "external")["type"] = "checkboxes"
        old_output = item(expected, "output")["attributes"]
        old_output["placeholder"] = item(new, "output")["attributes"]["placeholder"]
        self.assertIn("без автозакрытия", old_output["placeholder"])
        self.assertEqual(expected, new)
        old_q = yaml.safe_load(at_base(".github/ISSUE_TEMPLATE/question.yml"))
        new_q = form(".github/ISSUE_TEMPLATE/question.yml")
        old_q["body"][0]["attributes"]["value"] = new_q["body"][0]["attributes"]["value"]
        self.assertEqual(old_q, new_q)

    def test_all_52_core_labels_present_in_recorded_snapshot(self):
        planned = planned_labels(ROOT)
        snapshot = json.loads(text("tests/fixtures/labels-2026-11-03.json"))
        names = {entry["name"] for entry in snapshot}
        self.assertEqual(52, len(planned))
        self.assertEqual(52, len(set(planned)))
        self.assertEqual(set(), set(planned) - names)

    def test_active_templates_do_not_close_tasks_automatically(self):
        paths = (".github/ISSUE_TEMPLATE/task.yml", "docs/AGENT_RULES.md",
                 "docs/COORDINATOR_RULES.md", "docs/PROJECTS-BLUEPRINT.md",
                 "docs/templates/pull_request_template.md")
        closing = re.compile(r"\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+#", re.I)
        for path in paths:
            self.assertNotRegex(text(path), closing, path)
        self.assertIn("без автоматического закрытия", text("docs/templates/pull_request_template.md"))

    def test_root_installation_resolves_template_routes(self):
        with tempfile.TemporaryDirectory(prefix="agent-template-") as directory:
            project = Path(directory)
            shutil.copytree(ROOT / "docs", project / "docs")
            shutil.copy2(ROOT / "docs/AGENTS.md", project / "AGENTS.md")
            template = (project / "AGENTS.md").read_text(encoding="utf-8")
            routes = set(re.findall(r"`(docs/[A-Za-z_]+\.md)`", template))
            self.assertEqual({"docs/README.md", "docs/ADOPTION.md", "docs/AGENT_RULES.md",
                              "docs/COORDINATOR_RULES.md", "docs/KNOWLEDGE_BASE.md"}, routes)
            for route in routes:
                self.assertTrue((project / route).is_file(), route)
            self.assertNotRegex(template, r"\]\(\./(?:AGENT_RULES|COORDINATOR_RULES|KNOWLEDGE_BASE)\.md\)")

    def test_adoption_requires_preserving_existing_work(self):
        adoption = text("docs/ADOPTION.md")
        self.assertIn("Не перезаписывай", adoption)
        self.assertIn("входящие ревью", adoption)
        self.assertIn("временные", adoption)
        self.assertIn("не отменяет решение № 9", adoption)
        self.assertIn("не требование трёх физических стендов", adoption)

    def test_scripts_exactly_match_approved_base(self):
        # scripts/wait-signal исключён: историческая побайтовая проверка v2.1.0
        # против базы зафиксирована в docs/VALIDATION-2026-11-03.md (таблица
        # проверок, SHA-256 в примечании); актуальное поведение скрипта покрывают
        # поведенческие тесты tests/test_wait_signal.py.
        for path in ("docs/create-labels.sh", "docs/project-apply.sh"):
            with self.subTest(path=path):
                old = subprocess.check_output(["git", "show", f"{BASE}:{path}"], cwd=ROOT)
                self.assertEqual(old, (ROOT / path).read_bytes())

    def test_historical_material_is_unchanged(self):
        paths = ("docs/AUDIT.md", "docs/AUDIT-V2.md", "docs/TEST-REPORT.md",
                 "docs/TEST-REPORT-V2.md", "docs/TEST-REPORT-V3.md",
                 "docs/WORKFLOW-VARIANTS.md", "docs/FIELD-LESSONS-FONOTEXT.md",
                 "reference-workflow-source.txt")
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(at_base(path), text(path))

    def test_partial_markdown_link_scan(self):
        self.assertEqual([], inventory(ROOT, set())["broken_links"])

    def test_independence_cannot_be_self_claimed(self):
        self.assertIn("Собственная проверка не выдаётся за чужое ревью", text("PROTOCOL.md"))
        evidence = text("docs/EVIDENCE_RESEARCH.md")
        self.assertIn("Самопроверку не называй независимым ревью", evidence)
        self.assertIn("ревьювер поставки — не её автор", evidence)

    def test_research_has_sources_and_nist_limit(self):
        research = text("docs/RESEARCH-2026-11-03.md")
        for domain in ("anthropic.com", "openai.com", "docs.github.com", "langchain.com"):
            self.assertIn(domain, research)
        self.assertIn("не подтверждено", research)
        self.assertIn(BASE, research)


if __name__ == "__main__":
    unittest.main()
