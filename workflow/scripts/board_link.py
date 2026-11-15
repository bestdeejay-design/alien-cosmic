#!/usr/bin/env python3
"""board_link — машинная связка работа↔issue↔борд (issue #46, BOARD.md §Правила).

Чистые функции (тестируются без git/gh):
  extract_issue_refs(branch, commit_subjects) -> int | None
  classify_changes(files, added_lines) -> "trivial" | "substantive"
  count_added_nonblank(diff_text) -> int
  parse_gh_time(text) -> datetime (UTC)
  stale_entries(issues, remote_branches, pr_refs, now, hours) -> list[dict]
  preflight_gate(...) -> (warnings, failures)  # warning-канал отдельен от failures

CLI:
  --audit-prs            открытые PR ↔ issue: ссылка на issue в теле (канон 'Issue: #NN',
                         толерантно к 'Refs #NN' и др. — см. ISSUE_LINE_RE), issue открыт,
                         label status:*; номер-PR классифицируется как PR, не issue;
                         нарушения списком, exit 1 если непусто.
  --stale-report [HOURS] подвисшие issue (status:in-progress) без ветки <prefix>/NN-*
                         (префиксы — branch_prefixes project.json)
                         и без открытого PR со ссылкой на issue (см. --audit-prs),
                         updatedAt старше N часов
                         (дефолт 48); отчёт + предложение маркера 📣 PING; exit 0 всегда.
  --hygiene [--fix]      H-06 (audit #69): серверный bus-hygiene.yml не работает (биллинг
                         Actions) — локальный повтор его политики чистки закрытых issues.
                         Отчёт по закрытым с активными метками (status:{inbox,ready,
                         in-progress,blocked,review,rejected}, phase:*, launch-ready,
                         needs-human) + to:* (маршрутизация воркеров — только отчёт).
                         --fix снимает только метки «снять»-списка (gh issue edit
                         --remove-label), НЕ трогает type:* и to:*, без автозакрытия.
                         Отчёт печатается всегда; exit 1 = есть дрейф (в read-only)
                         или неудавшийся --remove-label.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from project_overlay import DEFAULT_BRANCH_PREFIXES, branch_regex, load_overlay  # noqa: E402

# Fallback при недоступном оверлее; рабочая версия всегда из branch_prefixes
# project.json (см. active_branch_re / allowed_branch_prefixes, issue #88/#143).
BRANCH_RE = re.compile(
    rf"^(?:{'|'.join(re.escape(p) for p in DEFAULT_BRANCH_PREFIXES)})"
    rf"/(?:(\d+)(?:-.*)?|[A-Za-z][\w.-]*)$"
)
REF_RE = re.compile(r"#(\d+)")
# H-01 (audit #69): каноническая строка связи PR↔issue — `Issue: #NN`, но парсер
# толерантен: принимаются `Refs/Resolves/Closes/Fixes #NN`, `Связано с issue #NN`,
# строка PR-шаблона с суффиксом (`- Issue: #NN · диапазон коммитов: ...`) и
# маркер-строка вида `#NN` в начале строки. Ослабляется только РАЗБОР текста:
# валидация цели (открытый issue с label status:*) в --audit-prs не меняется.
ISSUE_REF_KEYWORD = (
    r"(?:issue|refs?|resolves?|closes?|fixes?|related|linked|"
    r"связан\w*|ссылк\w*|реализ\w*)"
)
ISSUE_LINE_RE = re.compile(
    rf"(?:{ISSUE_REF_KEYWORD}\W{{0,20}}?#(\d+)\b)|(?:^[ \t]*[-*>·]*[ \t]*#(\d+)\b)",
    re.M | re.I | re.UNICODE,
)


def extract_pr_issue_refs(body: str | None) -> list[int]:
    """Номера issue из тела PR (толерантный разбор, H-01): без дублей, порядок появления."""
    refs: list[int] = []
    for first, second in ISSUE_LINE_RE.findall(body or ""):
        n = int(first or second)
        if n not in refs:
            refs.append(n)
    return refs
REMOTE_BRANCH_RE = re.compile(r"refs/heads/(\S+)$")

# Регламентные файлы/каталоги: их правка НИКОГДА не считается trivial.
REGULATORY_FILES = {
    "AGENTS.md",
    "BOARD.md",
    "WORKFLOW.md",
    "PROTOCOL.md",
    "OPS.md",
    "STATUS.md",
    "BUS.md",
    "DEBT.md",
}
# Каталоги, любое *.md внутри которых регламентно (L-03, audit #69):
# docs/ уже накрывает AGENT_RULES.md, COORDINATOR_RULES.md, KNOWLEDGE_BASE.md и
# decisions/, agents/ — карточки ролей, README и коллегиум.
REGULATORY_DIRS = (
    "docs/",
    "schema/",
    "agents/",
    "workflow/docs/",
    "workflow/schema/",
    "workflow/agents/",
)
# В skills/ регламентен только SKILL.md каждого навыка (README и вспомогательные
# файлы навыка остаются обычными *.md — иначе trivial-механика потеряет смысл).
REGULATORY_SKILL_SUFFIX = "/SKILL.md"

TRIVIAL_MAX_ADDED_LINES = 20
MAX_SUBJECTS = 500  # бюджет fallback-поиска по subjects коммитов
STALE_DEFAULT_HOURS = 48
ISSUE_JQ = '{state: .state, is_pr: (has("pull_request")), labels: [.labels[].name]}'

# H-06 (audit #69): серверный bus-hygiene.yml (чистка меток закрытых issues) не работает
# из-за биллинга Actions. Локальный режим --hygiene повторяет его strip-политику,
# кроме to:* — маршрутизация воркеров на закрытых задачах только попадает в отчёт,
# --fix её не снимает (минимальное вмешательство).
HYGIENE_STRIP_EXACT = {
    "launch-ready", "needs-human",
    "status:inbox", "status:ready", "status:in-progress",
    "status:blocked", "status:review", "status:rejected",
}
HYGIENE_STRIP_PREFIX = "phase:"
HYGIENE_REPORT_PREFIX = "to:"
HYGIENE_ISSUE_JQ = '{number: .number, title: .title, state: .state, labels: [.labels[].name]}'


def active_branch_re(canon_root: Path = ROOT) -> re.Pattern[str]:
    try:
        return branch_regex(load_overlay(canon_root))
    except ValueError:
        return BRANCH_RE


def allowed_branch_prefixes(canon_root: Path = ROOT) -> list[str]:
    """Допустимые префиксы веток — единственный источник branch_prefixes project.json (#88)."""
    try:
        return list(load_overlay(canon_root).get("branch_prefixes") or DEFAULT_BRANCH_PREFIXES)
    except ValueError:
        return list(DEFAULT_BRANCH_PREFIXES)


def branch_prefix_gate(branch: str, prefixes: list[str] | None = None) -> str | None:
    """Префикс-гейт (issue #88/M1): ветка обязана начинаться с префикса оверлея.

    Это не main-защита (её preflight держит отдельной проверкой): `main` и
    detached HEAD (`HEAD`) сюда не попадают. Возвращает текст failure или None.
    """
    if not prefixes:
        prefixes = allowed_branch_prefixes()
    b = (branch or "").strip()
    if not b or b in ("main", "HEAD"):
        return None
    if any(b == p or b.startswith(f"{p}/") for p in prefixes):
        return None
    return (
        f"ветка '{b}' вне допустимых префиксов branch_prefixes project.json "
        f"({', '.join(prefixes)}) — используй <prefix>/<NN>-<slug>"
    )


def extract_issue_refs(branch: str, commit_subjects: list[str], branch_re: re.Pattern[str] | None = None) -> int | None:
    """NN из имени ветки (<prefix>/NN-*, с учётом project.json), иначе первый `#NN` из subjects коммитов.

    Безномерная форма <prefix>/<slug> (например audit/<slug>, #143) номера не несёт —
    связь с issue ищется в subjects коммитов.
    """
    pat = branch_re or active_branch_re()
    m = pat.match(branch or "")
    if m and m.group(1):
        return int(m.group(1))
    for subject in (commit_subjects or [])[:MAX_SUBJECTS]:
        m = REF_RE.search(subject)
        if m:
            return int(m.group(1))
    return None


def classify_changes(files: list[str], added_lines: int) -> str:
    """trivial: только обычные *.md (не регламентные, не docs/, schema/, agents/,
    skills/*/SKILL.md) и ≤20 строк."""
    files = [f for f in (files or []) if f]
    if not files:
        return "substantive"
    for f in files:
        if not f.endswith(".md"):
            return "substantive"
        base_name = Path(f).name
        if f in REGULATORY_FILES or (f.startswith("workflow/") and base_name in REGULATORY_FILES):
            return "substantive"
        if f.startswith(REGULATORY_DIRS):
            return "substantive"
        if f.startswith("skills/") and f.endswith(REGULATORY_SKILL_SUFFIX):
            return "substantive"  # skills/<name>/SKILL.md (L-03, audit #69)
    if added_lines > TRIVIAL_MAX_ADDED_LINES:
        return "substantive"
    return "trivial"


def count_added_nonblank(diff_text: str) -> int:
    """Число добавленных непустых строк в unified diff."""
    total = 0
    for line in diff_text.splitlines():
        if line.startswith("+") and not line.startswith("+++") and line[1:].strip():
            total += 1
    return total


def parse_gh_time(text: str) -> datetime:
    """ISO-время GitHub ('...Z' или '+03:00') -> timezone-aware datetime в UTC."""
    t = (text or "").strip()
    if t.endswith("Z"):
        t = t[:-1] + "+00:00"
    dt = datetime.fromisoformat(t)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def stale_entries(
    issues: list[dict],
    remote_branches: list[str],
    pr_refs: set[int],
    now: datetime,
    hours: int,
) -> list[dict]:
    """Подвисшие issue: in-progress без ветки/PR и старше hours (будущее время — не stale)."""
    pat = active_branch_re()
    prefixes = allowed_branch_prefixes()
    out: list[dict] = []
    for it in issues or []:
        n = int(it["number"])
        has_branch = False
        for b in remote_branches or []:
            m = pat.match(b)
            if m and m.group(1) and int(m.group(1)) == n:
                has_branch = True
                break
        if has_branch or n in (pr_refs or set()):
            continue
        age_hours = (now - parse_gh_time(it["updatedAt"])).total_seconds() / 3600.0
        if age_hours <= hours:
            continue
        reasons = []
        if not has_branch:
            reasons.append(
                "нет remote-ветки <prefix>/NN-* (допустимые префиксы: "
                + ", ".join(prefixes) + ")"
            )
        if n not in (pr_refs or set()):
            reasons.append("нет открытого PR со ссылкой на issue ('Issue: #NN', толерантно)")
        out.append({"number": n, "age_hours": round(age_hours, 1), "reason": "; ".join(reasons)})
    return sorted(out, key=lambda e: -e["age_hours"])


def hygiene_findings(issues: list[dict]) -> list[dict]:
    """Чистое ядро --hygiene (H-06): закрытые issue с активными метками.

    Для каждого закрытого issue возвращает:
      remove      — метки, которые снял бы серверный bus-hygiene (status:* активные,
                    phase:*, launch-ready, needs-human);
      report_only — метки to:* (маршрутизация воркеров): только отчёт, --fix не трогает.
    Открытые issue и чистые закрытые (только status:done/type:*/size:* и т.п.) не входят.
    """
    out: list[dict] = []
    for it in issues or []:
        if str(it.get("state") or "").lower() != "closed":  # gh api: closed, gh issue list: CLOSED
            continue
        # gh api --jq отдаёт имена строками; gh issue list --json labels — объектами {name,...}
        labels = [
            str(label.get("name") if isinstance(label, dict) else label)
            for label in it.get("labels", [])
        ]
        remove = sorted(
            label for label in labels
            if label in HYGIENE_STRIP_EXACT or label.startswith(HYGIENE_STRIP_PREFIX)
        )
        report_only = sorted(
            label for label in labels if label.startswith(HYGIENE_REPORT_PREFIX)
        )
        if remove or report_only:
            out.append({
                "number": int(it["number"]),
                "title": (it.get("title") or "").strip(),
                "remove": remove,
                "report_only": report_only,
            })
    return sorted(out, key=lambda e: e["number"])


def cmd_hygiene(fix: bool, run_gh=None) -> int:
    """--hygiene: отчёт по дрейфу меток закрытых issues; --fix снимает только «снять»-метки.

    run_gh — инъекция для тестов (по умолчанию _gh); отчёт печатается всегда,
    автозакрытия нет, type:*/to:* не трогаются.
    """
    gh = run_gh or _gh
    res = gh(["issue", "list", "--state", "closed",
              "--json", "number,title,state,labels", "--limit", "300"])
    if res.returncode != 0:
        print(f"board_link: gh issue list failed: {res.stderr.strip()}", file=sys.stderr)
        return 1
    try:
        issues = json.loads(res.stdout or "[]")
    except ValueError:
        print("board_link: неожиданный ответ gh issue list (не JSON)", file=sys.stderr)
        return 1

    findings = hygiene_findings(issues)
    if not findings:
        print("board_link: hygiene — дрейфа меток на закрытых issues нет")
        return 0

    print(f"board_link: hygiene — закрытые issues с активными метками ({len(findings)}):")
    for f in findings:
        parts = []
        if f["remove"]:
            parts.append("снять: " + ", ".join(f["remove"]))
        if f["report_only"]:
            parts.append("маршрутизация (вручную): " + ", ".join(f["report_only"]))
        print(f"  - #{f['number']} «{f['title']}» — {'; '.join(parts)}")

    failed: list[str] = []
    if fix:
        for f in findings:
            for label in f["remove"]:
                rm = gh(["issue", "edit", str(f["number"]), "--remove-label", label])
                if rm.returncode != 0:
                    failed.append(f"#{f['number']}: --remove-label {label}: {rm.stderr.strip()}")
                else:
                    print(f"  - снято: #{f['number']} — {label}")
        if failed:
            print("board_link: hygiene --fix — не все метки сняты:", file=sys.stderr)
            for msg in failed:
                print(f"  - {msg}", file=sys.stderr)
            return 1
        print("board_link: hygiene --fix — статусные/phase-метки сняты "
              "(to:* и type:* не тронуты, автозакрытия нет)")
        return 0
    print("board_link: hygiene — прогон с --fix снимет метки «снять» "
          "(to:* только в отчёте, type:* не трогается)")
    return 1


def preflight_gate(
    branch: str,
    commit_subjects: list[str],
    files: list[str],
    added_lines: int,
    *,
    scope_known: bool = True,
    strict: bool = False,
    allow_trivial: bool = False,
    gh_lookup=None,
) -> tuple[list[str], list[str]]:
    """Гейт «ветка ↔ issue» для preflight.

    Возвращает (warnings, failures): warning-канал отдельен от failures и квитанции.
    gh_lookup(ref) -> {"state", "labels", "is_pr"} или {"error": str}; None = gh недоступен.
    Пустой диапазон коммитов (subjects == []) — молча skip, включая strict.

    Принуждение на пути сдачи (коллегия ADR-0002): issue с size:M/size:L без
    phase:action = реализация до гейта CONCLUSION — failure (поставка не признаётся).
    size:S (Fast-Track, единый источник — agents/collegium.md §3) гейта не требует.
    HOTFIX объявляет только координатор (COORDINATOR_RULES §7) — тогда явный
    --trivial с пометкой. gh недоступен/ошибка — warning, never error.
    """
    warnings: list[str] = []
    failures: list[str] = []
    if not scope_known:
        warnings.append("board-link: нет origin, проверка ветка↔issue пропущена")
        return warnings, failures
    if not [s for s in (commit_subjects or []) if s.strip()]:
        return warnings, failures  # пустой base..HEAD — молча skip, даже в strict

    ref = extract_issue_refs(branch, commit_subjects)
    kind = classify_changes(files, added_lines)
    if kind == "trivial":
        return warnings, failures  # bypass ДО любых вызовов gh
    if allow_trivial:
        warnings.append("board-link: явный bypass (--trivial) — проверка ветка↔issue пропущена")
        return warnings, failures

    if ref is None:
        msg = "board-link: ветка и subjects коммитов не ссылаются на issue — оформи issue или используй --trivial"
        if strict:
            failures.append(msg)
        else:
            warnings.append(msg)
        return warnings, failures

    if gh_lookup is None:
        warnings.append(f"board-link: issue #{ref} не верифицирован (gh/сеть недоступны)")
        return warnings, failures
    info = gh_lookup(ref)
    if info.get("error"):
        warnings.append(f"board-link: issue #{ref} не верифицирован ({info['error']})")
    elif info.get("is_pr"):
        warnings.append(f"board-link: ссылка #{ref} указывает на PR, а не на issue")
    elif info.get("state") != "open":
        warnings.append(f"board-link: issue #{ref} не открыт (state={info.get('state')})")
    elif not any(str(label).startswith("status:") for label in info.get("labels", [])):
        warnings.append(f"board-link: у issue #{ref} нет label status:*")
    if (
        info.get("state") == "open"
        and any(str(label).startswith("status:") for label in info.get("labels", []))
    ):
        labels = [str(label) for label in info.get("labels", [])]
        if any(label in ("size:M", "size:L") for label in labels) and "phase:action" not in labels:
            failures.append(
                f"board-link: issue #{ref} size:M/L без phase:action — "
                "реализация до гейта CONCLUSION не признаётся (коллегия ADR-0002); "
                "попросите координатора открыть phase:action "
                "(HOTFIX объявляет только координатор, COORDINATOR_RULES §7 — тогда явный --trivial)"
            )
    return warnings, failures


def audit_pr_findings(prs: list[dict], lookup) -> list[str]:
    """Чистое ядро --audit-prs: нарушения связи PR ↔ issue по регэкспу 'Issue: #NN'."""
    findings: list[str] = []
    for pr in prs or []:
        num = pr.get("number")
        title = (pr.get("title") or "").strip()
        refs = sorted(set(extract_pr_issue_refs(pr.get("body"))))
        if not refs:
            findings.append(f"PR #{num} «{title}»: нет строки 'Issue: #NN'")
            continue
        for n in refs:
            info = lookup(n) or {"error": "нет данных"}
            if info.get("error"):
                findings.append(f"PR #{num}: issue #{n} не удалось проверить ({info['error']})")
            elif info.get("is_pr"):
                findings.append(f"PR #{num}: ссылка 'Issue: #{n}' указывает на PR, а не на issue")
            elif info.get("state") != "open":
                findings.append(f"PR #{num}: issue #{n} не открыт (state={info.get('state')})")
            elif not any(str(label).startswith("status:") for label in info.get("labels", [])):
                findings.append(f"PR #{num}: у issue #{n} нет label status:*")
    return findings


def soft_run(argv: list[str], cwd: Path = ROOT) -> subprocess.CompletedProcess[str]:
    """subprocess без краша при отсутствии бинаря в PATH (контракт «soft-check, never error»)."""
    try:
        return subprocess.run(argv, cwd=cwd, text=True, capture_output=True, check=False)
    except FileNotFoundError:
        return subprocess.CompletedProcess(
            argv, returncode=127, stdout="",
            stderr=f"{argv[0]} недоступен (не найден в PATH)",
        )


def _gh(argv: list[str]) -> subprocess.CompletedProcess[str]:
    return soft_run(["gh", *argv])


def _git(argv: list[str]) -> subprocess.CompletedProcess[str]:
    return soft_run(argv)


def _issue_lookup_from_gh(repo: str):
    def lookup(ref: int) -> dict:
        if not repo:
            return {"error": "не удалось определить репозиторий (gh repo view)"}
        res = _gh(["api", f"repos/{repo}/issues/{ref}", "--jq", ISSUE_JQ])
        if res.returncode != 0:
            first = (res.stderr.strip().splitlines() or ["gh api failed"])[0]
            return {"error": first}
        try:
            return json.loads(res.stdout)
        except ValueError:
            return {"error": "неожиданный ответ gh api"}
    return lookup


def cmd_audit_prs() -> int:
    res = _gh(["pr", "list", "--state", "open", "--json", "number,title,body", "--limit", "200"])
    if res.returncode != 0:
        print(f"board_link: gh pr list failed: {res.stderr.strip()}", file=sys.stderr)
        return 1
    prs = json.loads(res.stdout or "[]")
    repo_res = _gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])
    lookup = _issue_lookup_from_gh(repo_res.stdout.strip() if repo_res.returncode == 0 else "")
    findings = audit_pr_findings(prs, lookup)
    if findings:
        print("board_link: нарушения PR↔issue:")
        for f in findings:
            print(f"  - {f}")
        return 1
    print("board_link: PR↔issue — нарушений нет")
    return 0


def cmd_stale_report(hours: int) -> int:
    issues: list[dict] = []
    res = _gh(["issue", "list", "--state", "open", "--label", "status:in-progress",
               "--json", "number,title,updatedAt", "--limit", "200"])
    if res.returncode != 0:
        print(f"board_link: gh недоступен, отчёт неполный: {res.stderr.strip()}", file=sys.stderr)
    else:
        issues = json.loads(res.stdout or "[]")

    pr_refs: set[int] = set()
    pres = _gh(["pr", "list", "--state", "open", "--json", "number,body", "--limit", "200"])
    if pres.returncode == 0:
        for pr in json.loads(pres.stdout or "[]"):
            pr_refs.update(extract_pr_issue_refs(pr.get("body")))

    branches: list[str] = []
    br = _git(["git", "ls-remote", "--heads", "origin"])
    if br.returncode == 0:
        for line in br.stdout.splitlines():
            m = REMOTE_BRANCH_RE.search(line.strip())
            if m:
                branches.append(m.group(1))

    entries = stale_entries(issues, branches, pr_refs, datetime.now(timezone.utc), hours)
    if not entries:
        print("board_link: подвисших issue (status:in-progress без ветки/PR) нет")
        return 0
    print(f"board_link: подвисшие issue (status:in-progress, старше {hours}ч, без ветки/PR):")
    for e in entries:
        print(f"  - #{e['number']} — {e['age_hours']}ч — {e['reason']} — предложи маркер 📣 PING")
    return 0


def _positive_hours(text: str) -> int:
    try:
        value = int(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"HOURS должно быть положительным целым, получено: {text!r}")
    if value <= 0:
        raise argparse.ArgumentTypeError(f"HOURS должно быть положительным целым, получено: {text!r}")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="board_link — машинная связка работа↔issue↔борд")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--audit-prs", action="store_true", help="Проверить открытые PR на ссылку на issue (канон 'Issue: #NN', толерантный разбор) и статус issue")
    group.add_argument("--stale-report", dest="stale_report", metavar="HOURS", type=_positive_hours,
                       nargs="?", const=STALE_DEFAULT_HOURS, default=None,
                       help=f"Отчёт по подвисшим in-progress issue старше HOURS часов (дефолт {STALE_DEFAULT_HOURS})")
    group.add_argument("--hygiene", action="store_true",
                       help="Отчёт по закрытым issues с активными метками (H-06, локальная замена серверного bus-hygiene)")
    parser.add_argument("--fix", action="store_true",
                        help="Вместе с --hygiene: снять статусные/phase-метки с закрытых issues (to:*/type:* не трогаются)")
    args = parser.parse_args(argv)

    if args.audit_prs:
        return cmd_audit_prs()
    if args.hygiene:
        return cmd_hygiene(fix=args.fix)
    return cmd_stale_report(int(args.stale_report))


if __name__ == "__main__":
    raise SystemExit(main())
