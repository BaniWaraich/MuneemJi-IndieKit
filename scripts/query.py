"""
Ask the knowledge base a question.

Usage:
    uv run python scripts/query.py "What auth patterns do I use?"
    uv run python scripts/query.py "What's my error handling strategy?" --file-back
"""

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import KNOWLEDGE_DIR, ROOT_DIR
from utils import (
    list_wiki_articles,
    load_state,
    read_all_articles,
    read_knowledge_index,
    save_state,
)


async def run_query(question: str, file_back: bool) -> None:
    from claude_code_sdk import ClaudeCodeOptions, query, AssistantMessage, TextBlock

    index = read_knowledge_index()
    all_articles = read_all_articles()

    if not index and not all_articles:
        print("Knowledge base is empty. Run compile.py first.")
        return

    prompt = f"""You are querying a personal software developer knowledge base.

## Knowledge Base Index

{index or "(empty)"}

---

## All Articles

{all_articles or "(none)"}

---

## Question

{question}

---

## Instructions

1. Read the index to identify the 3-10 most relevant articles for this question.
2. Synthesize a clear, precise answer using [[wikilink]] citations to the articles you consulted.
3. If you cannot find relevant information, say so clearly.
{"4. After your answer, output a YAML block for filing: ```yaml\\nfile_back: true\\nconsulted: [list article paths]\\n```" if file_back else ""}
"""

    answer_parts: list[str] = []
    async for message in query(
        prompt=prompt,
        options=ClaudeCodeOptions(
            cwd=str(ROOT_DIR),
            allowed_tools=[],
            max_turns=3,
        ),
    ):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    answer_parts.append(block.text)

    answer = "\n".join(answer_parts).strip()
    print(answer)

    if file_back and answer:
        _file_answer(question, answer)

    state = load_state()
    state["query_count"] = state.get("query_count", 0) + 1
    save_state(state)


def _file_answer(question: str, answer: str) -> None:
    """Write a Q&A article to knowledge/qa/ and update index + log."""
    from claude_code_sdk import ClaudeCodeOptions
    qa_dir = KNOWLEDGE_DIR / "qa"
    qa_dir.mkdir(parents=True, exist_ok=True)

    slug = question.lower()[:60].replace(" ", "-").replace("?", "").replace("'", "")
    slug = "".join(c for c in slug if c.isalnum() or c == "-")
    today = datetime.now().strftime("%Y-%m-%d")
    qa_path = qa_dir / f"{slug}.md"

    content = f"""---
title: "Q: {question}"
question: "{question}"
consulted: []
filed: {today}
---

# Q: {question}

## Answer

{answer}

## Sources Consulted

(See [[knowledge/index]] for article list)
"""
    qa_path.write_text(content, encoding="utf-8")

    # Append to log
    log_path = KNOWLEDGE_DIR / "log.md"
    ts = datetime.now(timezone.utc).isoformat()
    entry = f"\n## [{ts}] query | \"{question}\"\n- Filed to: [[qa/{slug}]]\n"
    with log_path.open("a", encoding="utf-8") as f:
        f.write(entry)

    print(f"\n[filed to knowledge/qa/{slug}.md]")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Query the knowledge base")
    parser.add_argument("question", help="The question to ask")
    parser.add_argument("--file-back", action="store_true", help="Save answer as a Q&A article")
    args = parser.parse_args()

    asyncio.run(run_query(args.question, args.file_back))
