"""
Compile daily logs into structured knowledge articles.

Usage:
    uv run python scripts/compile.py              # compile new/changed only
    uv run python scripts/compile.py --all        # force recompile everything
    uv run python scripts/compile.py --file daily/2026-04-01.md
    uv run python scripts/compile.py --dry-run
"""

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import KNOWLEDGE_DIR, ROOT_DIR, SCRIPTS_DIR
from utils import (
    iter_daily_logs,
    list_wiki_articles,
    load_state,
    read_knowledge_index,
    save_state,
    sha256_file,
)

AGENTS_MD = (ROOT_DIR / "AGENTS.md").read_text(encoding="utf-8") if (ROOT_DIR / "AGENTS.md").exists() else ""


def build_compile_prompt(daily_path: Path) -> str:
    daily_content = daily_path.read_text(encoding="utf-8")
    index = read_knowledge_index()

    existing_articles: list[str] = []
    for article in list_wiki_articles():
        existing_articles.append(
            f"### {article.relative_to(KNOWLEDGE_DIR)}\n\n{article.read_text(encoding='utf-8')}"
        )
    articles_block = "\n\n---\n\n".join(existing_articles) if existing_articles else "(none yet)"

    return f"""You are the knowledge base compiler for a software developer's personal KB.

## Schema (your operating spec)

{AGENTS_MD}

---

## Current Knowledge Base Index

{index or "(empty — no articles compiled yet)"}

---

## Existing Articles

{articles_block}

---

## Daily Log to Compile

File: {daily_path.name}

{daily_content}

---

## Your Task

1. Read the daily log above.
2. For each piece of knowledge (decisions, lessons, patterns, gotchas):
   - If an existing concept article covers this topic → UPDATE it (add new info, add this log as a source).
   - If it's a new topic → CREATE a new `knowledge/concepts/<slug>.md` article.
3. If the log reveals a non-obvious connection between 2+ existing concepts → CREATE `knowledge/connections/<slug>.md`.
4. UPDATE `knowledge/index.md` with any new or modified entries.
5. APPEND a compile entry to `knowledge/log.md`.

Follow the article formats defined in AGENTS.md exactly (YAML frontmatter, wikilinks, encyclopedia style).
Use Obsidian-style [[wikilinks]] with full relative paths from the knowledge/ directory.
Write in encyclopedia style — factual, concise, self-contained.
"""


async def compile_file(daily_path: Path, dry_run: bool = False) -> None:
    from claude_code_sdk import ClaudeCodeOptions, query

    print(f"Compiling {daily_path.name}...")

    if dry_run:
        print(f"  [dry-run] would compile {daily_path.name}")
        return

    prompt = build_compile_prompt(daily_path)

    async for message in query(
        prompt=prompt,
        options=ClaudeCodeOptions(
            cwd=str(ROOT_DIR),
            allowed_tools=["Read", "Write", "Edit", "Glob", "Grep"],
            permission_mode="acceptEdits",
            max_turns=30,
        ),
    ):
        pass  # Claude writes files directly via tool use

    # Update state with new hash
    state = load_state()
    state.setdefault("ingested", {})[daily_path.name] = {
        "hash": sha256_file(daily_path),
        "compiled_at": datetime.now(timezone.utc).isoformat(),
    }
    save_state(state)
    print(f"  Done: {daily_path.name}")


async def main() -> None:
    parser = argparse.ArgumentParser(description="Compile daily logs to knowledge articles")
    parser.add_argument("--all", action="store_true", help="Force recompile all daily logs")
    parser.add_argument("--file", type=Path, help="Compile a specific daily log file")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be compiled without doing it")
    args = parser.parse_args()

    if args.file:
        target = args.file if args.file.is_absolute() else ROOT_DIR / args.file
        if not target.exists():
            print(f"File not found: {target}", file=sys.stderr)
            sys.exit(1)
        await compile_file(target, dry_run=args.dry_run)
        return

    state = load_state()
    ingested = state.get("ingested", {})

    to_compile: list[Path] = []
    for log in iter_daily_logs():
        if args.all:
            to_compile.append(log)
        else:
            current_hash = sha256_file(log)
            if ingested.get(log.name, {}).get("hash") != current_hash:
                to_compile.append(log)

    if not to_compile:
        print("Nothing to compile — all daily logs are up to date.")
        return

    for log in to_compile:
        await compile_file(log, dry_run=args.dry_run)


if __name__ == "__main__":
    asyncio.run(main())
