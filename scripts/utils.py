import hashlib
import json
from pathlib import Path
from typing import Iterator

from config import (
    KNOWLEDGE_DIR,
    DAILY_DIR,
    STATE_FILE,
    LAST_FLUSH_FILE,
)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def list_wiki_articles() -> list[Path]:
    """All article .md files under knowledge/ (excludes index.md and log.md)."""
    articles: list[Path] = []
    for subdir in ("concepts", "connections", "qa"):
        d = KNOWLEDGE_DIR / subdir
        if d.exists():
            articles.extend(sorted(d.glob("*.md")))
    return articles


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"ingested": {}, "query_count": 0, "last_lint": None, "total_cost": 0.0}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def load_last_flush() -> dict:
    if LAST_FLUSH_FILE.exists():
        return json.loads(LAST_FLUSH_FILE.read_text(encoding="utf-8"))
    return {}


def save_last_flush(data: dict) -> None:
    LAST_FLUSH_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def iter_daily_logs() -> Iterator[Path]:
    """Yield daily log .md files sorted by date (oldest first)."""
    if DAILY_DIR.exists():
        yield from sorted(DAILY_DIR.glob("*.md"))


def extract_transcript_text(jsonl_path: Path) -> str:
    """Convert a Claude Code JSONL transcript into readable markdown text."""
    lines: list[str] = []
    try:
        raw_text = jsonl_path.read_text(encoding="utf-8", errors="replace")
        for raw in raw_text.splitlines():
            raw = raw.strip()
            if not raw:
                continue
            try:
                entry = json.loads(raw)
            except json.JSONDecodeError:
                continue
            msg = entry.get("message", {})
            role = msg.get("role", "")
            content = msg.get("content", "")
            if not role or not content:
                continue
            if isinstance(content, str):
                text = content.strip()
            elif isinstance(content, list):
                parts = [
                    block.get("text", "").strip()
                    for block in content
                    if isinstance(block, dict) and block.get("type") == "text"
                ]
                text = "\n".join(p for p in parts if p)
            else:
                continue
            if text:
                lines.append(f"**{role.upper()}:** {text}")
    except Exception:
        pass
    return "\n\n".join(lines)


def read_knowledge_index() -> str:
    index = KNOWLEDGE_DIR / "index.md"
    if index.exists():
        return index.read_text(encoding="utf-8")
    return ""


def read_all_articles() -> str:
    """Return all article content concatenated with headers (for query context)."""
    parts: list[str] = []
    for article in list_wiki_articles():
        parts.append(f"### {article.relative_to(KNOWLEDGE_DIR)}\n\n{article.read_text(encoding='utf-8')}")
    return "\n\n---\n\n".join(parts)
