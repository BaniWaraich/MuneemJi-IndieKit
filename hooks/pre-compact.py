"""
PreCompact hook — captures context before Claude Code auto-compacts the context window.

Same architecture as session-end.py. Guards against empty transcript_path
(known Claude Code bug #13668 where transcript_path may be absent).

Reads JSON from stdin: { session_id, transcript_path, cwd }
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent


def main() -> None:
    # Recursion guard
    if os.environ.get("CLAUDE_INVOKED_BY"):
        sys.exit(0)

    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except Exception:
        sys.exit(0)

    session_id = data.get("session_id", "unknown")
    transcript_path = data.get("transcript_path", "")

    # Guard against known bug #13668 — transcript_path may be empty or missing
    if not transcript_path:
        sys.exit(0)

    tp = Path(transcript_path)
    if not tp.exists() or tp.stat().st_size == 0:
        sys.exit(0)

    try:
        tmp = tempfile.NamedTemporaryFile(
            suffix=".jsonl",
            prefix=f"claude-precompact-{session_id}-",
            delete=False,
        )
        tmp.close()
        shutil.copy2(tp, tmp.name)
        tmp_path = tmp.name
    except Exception:
        sys.exit(0)

    _spawn_flush(tmp_path, session_id)


def _spawn_flush(tmp_path: str, session_id: str) -> None:
    flush_script = ROOT_DIR / "scripts" / "flush.py"
    env = os.environ.copy()
    env["CLAUDE_INVOKED_BY"] = "pre_compact_hook"

    cmd = ["uv", "run", "python", str(flush_script), tmp_path, session_id]

    if sys.platform == "win32":
        subprocess.Popen(
            cmd,
            cwd=str(ROOT_DIR),
            env=env,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        subprocess.Popen(
            cmd,
            cwd=str(ROOT_DIR),
            env=env,
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


if __name__ == "__main__":
    main()
