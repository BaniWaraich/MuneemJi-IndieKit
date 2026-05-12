"""
Run health checks on the knowledge base.

Usage:
    uv run python scripts/lint.py                    # all 7 checks
    uv run python scripts/lint.py --structural-only  # skip LLM contradiction check (free)
"""

import argparse
import asyncio
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import DAILY_DIR, KNOWLEDGE_DIR, REPORTS_DIR, ROOT_DIR
from utils import iter_daily_logs, list_wiki_articles, load_state, save_state


def _slug_to_path(link: str) -> Path:
    """Resolve a [[wikilink]] (relative to knowledge/) to an absolute path."""
    clean = link.strip("[]").strip()
    if not clean.endswith(".md"):
        clean += ".md"
    return KNOWLEDGE_DIR / clean


def _find_wikilinks(text: str) -> list[str]:
    return re.findall(r"\[\[([^\]]+)\]\]", text)


def check_broken_links(articles: list[Path]) -> list[str]:
    errors: list[str] = []
    for article in articles:
        text = article.read_text(encoding="utf-8")
        for link in _find_wikilinks(text):
            target = _slug_to_path(link)
            if not target.exists():
                rel = article.relative_to(KNOWLEDGE_DIR)
                errors.append(f"**ERROR** Broken link `[[{link}]]` in `{rel}`")
    return errors


def check_orphan_pages(articles: list[Path]) -> list[str]:
    """Articles with zero inbound links from other articles."""
    inbound: dict[str, int] = {str(a.relative_to(KNOWLEDGE_DIR)).replace("\\", "/"): 0 for a in articles}
    for article in articles:
        text = article.read_text(encoding="utf-8")
        for link in _find_wikilinks(text):
            key = link if link.endswith(".md") else link + ".md"
            if key in inbound:
                inbound[key] += 1
    warnings: list[str] = []
    for path, count in inbound.items():
        if count == 0:
            warnings.append(f"**WARNING** Orphan page (no inbound links): `{path}`")
    return warnings


def check_orphan_sources() -> list[str]:
    """Daily logs that haven't been compiled yet."""
    from utils import load_state, sha256_file
    state = load_state()
    ingested = state.get("ingested", {})
    warnings: list[str] = []
    for log in iter_daily_logs():
        current_hash = sha256_file(log)
        if ingested.get(log.name, {}).get("hash") != current_hash:
            warnings.append(f"**WARNING** Uncompiled daily log: `daily/{log.name}`")
    return warnings


def check_stale_articles(articles: list[Path]) -> list[str]:
    """Articles whose source daily logs changed since compilation."""
    from utils import load_state, sha256_file
    state = load_state()
    ingested = state.get("ingested", {})
    warnings: list[str] = []
    for article in articles:
        text = article.read_text(encoding="utf-8")
        sources = re.findall(r'sources:\s*\n((?:\s+-\s+".+"\n)+)', text)
        if not sources:
            continue
        for src_line in re.findall(r'"(daily/[^"]+)"', sources[0]):
            src_name = Path(src_line).name
            log_path = DAILY_DIR / src_name
            if log_path.exists():
                current_hash = sha256_file(log_path)
                if ingested.get(src_name, {}).get("hash") != current_hash:
                    rel = article.relative_to(KNOWLEDGE_DIR)
                    warnings.append(f"**WARNING** Stale article `{rel}` — source `{src_line}` changed since compilation")
    return warnings


def check_missing_backlinks(articles: list[Path]) -> list[str]:
    """A links to B but B doesn't link back to A."""
    # Build forward link map
    forward: dict[str, set[str]] = {}
    for article in articles:
        key = str(article.relative_to(KNOWLEDGE_DIR)).replace("\\", "/")
        forward[key] = set()
        text = article.read_text(encoding="utf-8")
        for link in _find_wikilinks(text):
            target_key = link if link.endswith(".md") else link + ".md"
            forward[key].add(target_key)

    warnings: list[str] = []
    for src, targets in forward.items():
        for target in targets:
            if target in forward and src not in forward.get(target, set()):
                warnings.append(f"**WARNING** Missing backlink: `{target}` doesn't link back to `{src}`")
    return warnings


def check_sparse_articles(articles: list[Path]) -> list[str]:
    suggestions: list[str] = []
    for article in articles:
        text = article.read_text(encoding="utf-8")
        word_count = len(text.split())
        if word_count < 200:
            rel = article.relative_to(KNOWLEDGE_DIR)
            suggestions.append(f"**SUGGESTION** Sparse article ({word_count} words): `{rel}`")
    return suggestions


async def check_contradictions(articles: list[Path]) -> list[str]:
    if not articles:
        return []
    from claude_code_sdk import ClaudeCodeOptions, query, AssistantMessage, TextBlock

    combined = "\n\n---\n\n".join(
        f"### {a.relative_to(KNOWLEDGE_DIR)}\n\n{a.read_text(encoding='utf-8')}"
        for a in articles
    )
    prompt = f"""You are auditing a personal knowledge base for contradictions.

Review the articles below. Identify any claims that directly contradict each other across different articles.
For each contradiction found, output: **CONTRADICTION** `article1` vs `article2`: <brief description>
If no contradictions found, output: No contradictions found.

{combined[:30_000]}
"""
    result_parts: list[str] = []
    async for message in query(
        prompt=prompt,
        options=ClaudeCodeOptions(
            cwd=str(ROOT_DIR),
            allowed_tools=[],
            max_turns=2,
        ),
    ):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    result_parts.append(block.text)

    result = "\n".join(result_parts).strip()
    if "no contradictions" in result.lower():
        return []
    return [line for line in result.splitlines() if line.strip()]


async def main() -> None:
    parser = argparse.ArgumentParser(description="Lint the knowledge base")
    parser.add_argument("--structural-only", action="store_true", help="Skip LLM contradiction check")
    args = parser.parse_args()

    articles = list_wiki_articles()
    today = datetime.now().strftime("%Y-%m-%d")
    report_lines: list[str] = [f"# Lint Report — {today}\n"]

    checks = [
        ("Broken Links", check_broken_links(articles)),
        ("Orphan Pages", check_orphan_pages(articles)),
        ("Orphan Sources", check_orphan_sources()),
        ("Stale Articles", check_stale_articles(articles)),
        ("Missing Backlinks", check_missing_backlinks(articles)),
        ("Sparse Articles", check_sparse_articles(articles)),
    ]

    if not args.structural_only:
        contradictions = await check_contradictions(articles)
        checks.append(("Contradictions (LLM)", contradictions))

    total_issues = 0
    for check_name, findings in checks:
        report_lines.append(f"\n## {check_name}\n")
        if findings:
            report_lines.extend(findings)
            total_issues += len(findings)
        else:
            report_lines.append("✓ No issues found.")

    report_lines.append(f"\n---\n\n**Total issues:** {total_issues}")
    report = "\n".join(report_lines)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORTS_DIR / f"lint-{today}.md"
    report_path.write_text(report, encoding="utf-8")

    print(report)
    print(f"\nReport saved to {report_path}")

    state = load_state()
    state["last_lint"] = datetime.now(timezone.utc).isoformat()
    save_state(state)


if __name__ == "__main__":
    asyncio.run(main())
