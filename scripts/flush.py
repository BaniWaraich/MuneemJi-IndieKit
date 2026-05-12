"""
Background process spawned by session-end.py and pre-compact.py.

Usage: uv run python scripts/flush.py <transcript_jsonl_path> <session_id>

Reads the JSONL transcript, extracts conversation text, calls Claude to decide
what's worth saving, appends to today's daily log, and optionally triggers
end-of-day compilation.
"""

import asyncio
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import (
    COMPILE_AFTER_HOUR,
    DAILY_DIR,
    FLUSH_DEDUP_SECONDS,
    ROOT_DIR,
    SCRIPTS_DIR,
)
from utils import (
    extract_transcript_text,
    load_last_flush,
    load_state,
    save_last_flush,
    save_state,
    sha256_file,
)

# Set recursion guard before any Claude SDK import
os.environ.setdefault("CLAUDE_INVOKED_BY", "memory_flush")


async def run_flush(transcript_path: Path, session_id: str) -> None:
    from claude_code_sdk import ClaudeCodeOptions, query

    # Deduplication: skip if same session was flushed recently
    last_flush = load_last_flush()
    now = time.time()
    if last_flush.get("session_id") == session_id:
        elapsed = now - last_flush.get("timestamp", 0)
        if elapsed < FLUSH_DEDUP_SECONDS:
            return

    context = extract_transcript_text(transcript_path)
    if not context.strip():
        return

    today = datetime.now().strftime("%Y-%m-%d")
    daily_path = DAILY_DIR / f"{today}.md"
    DAILY_DIR.mkdir(parents=True, exist_ok=True)

    # Load existing daily log header or create it
    if not daily_path.exists():
        daily_path.write_text(f"# Daily Log: {today}\n\n## Sessions\n\n", encoding="utf-8")

    prompt = f"""You are compiling a daily knowledge log for a software developer.

Below is a raw AI coding session transcript. Extract only what is worth remembering:
- Key technical decisions and WHY they were made
- Bugs found and how they were fixed
- Patterns, gotchas, or lessons learned
- Architecture choices

Format your output as a markdown session block to append to today's log:

```markdown
### Session ({datetime.now().strftime('%H:%M')}) - <brief title>

**Context:** <one sentence>

**Key Exchanges:**
- <bullet>

**Decisions Made:**
- <bullet>

**Lessons Learned:**
- <bullet>
```

If nothing meaningful happened (e.g. the session was trivial or just reading), respond with exactly: FLUSH_OK

---

TRANSCRIPT:
{context[:15_000]}
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
        from claude_code_sdk import AssistantMessage, TextBlock
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    result_parts.append(block.text)

    result = "\n".join(result_parts).strip()

    if result and result != "FLUSH_OK":
        with daily_path.open("a", encoding="utf-8") as f:
            f.write(f"\n{result}\n")

    # Record flush
    save_last_flush({"session_id": session_id, "timestamp": now})

    # Clean up temp transcript
    try:
        transcript_path.unlink(missing_ok=True)
    except Exception:
        pass

    # End-of-day auto-compilation: trigger if past COMPILE_AFTER_HOUR and daily log changed
    _maybe_compile(daily_path, today)


def _maybe_compile(daily_path: Path, today: str) -> None:
    hour = datetime.now().hour
    if hour < COMPILE_AFTER_HOUR:
        return
    if not daily_path.exists():
        return

    state = load_state()
    current_hash = sha256_file(daily_path)
    ingested = state.get("ingested", {})
    last_hash = ingested.get(today, {}).get("hash")
    if current_hash == last_hash:
        return  # already compiled this version

    compile_script = SCRIPTS_DIR / "compile.py"
    env = os.environ.copy()
    env["CLAUDE_INVOKED_BY"] = "auto_compile"

    if sys.platform == "win32":
        subprocess.Popen(
            ["uv", "run", "python", str(compile_script), "--file", str(daily_path)],
            cwd=str(ROOT_DIR),
            env=env,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        subprocess.Popen(
            ["uv", "run", "python", str(compile_script), "--file", str(daily_path)],
            cwd=str(ROOT_DIR),
            env=env,
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: flush.py <transcript_jsonl_path> <session_id>", file=sys.stderr)
        sys.exit(1)

    transcript_path = Path(sys.argv[1])
    session_id = sys.argv[2]

    if not transcript_path.exists():
        sys.exit(0)

    asyncio.run(run_flush(transcript_path, session_id))
