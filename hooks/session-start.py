"""
SessionStart hook — injects knowledge base context into every Claude session.

Pure local I/O, no API calls. Must complete in under 1 second.
Outputs JSON to stdout consumed by Claude Code.
"""

import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
KNOWLEDGE_DIR = ROOT_DIR / "knowledge"
DAILY_DIR = ROOT_DIR / "daily"
MAX_CHARS = 20_000


def main() -> None:
    context_parts: list[str] = []

    index_path = KNOWLEDGE_DIR / "index.md"
    if index_path.exists():
        content = index_path.read_text(encoding="utf-8")
        context_parts.append(f"## Knowledge Base Index\n\n{content}")

    if DAILY_DIR.exists():
        daily_files = sorted(DAILY_DIR.glob("*.md"), reverse=True)
        if daily_files:
            recent = daily_files[0]
            content = recent.read_text(encoding="utf-8")
            context_parts.append(f"## Recent Daily Log ({recent.name})\n\n{content}")

    combined = "\n\n---\n\n".join(context_parts)
    if len(combined) > MAX_CHARS:
        combined = combined[:MAX_CHARS] + "\n\n[... truncated at 20,000 chars ...]"

    if not combined:
        combined = (
            "Knowledge base is empty. No daily logs or articles exist yet. "
            "Sessions will be captured automatically via hooks."
        )

    output = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": combined,
        }
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
