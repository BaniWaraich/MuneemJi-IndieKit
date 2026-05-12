"""
SessionEnd hook — copies transcript and spawns flush.py as a detached background process.

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
    # Recursion guard: flush.py sets this before invoking Claude SDK
    if os.environ.get("CLAUDE_INVOKED_BY"):
        sys.exit(0)

    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except Exception:
        sys.exit(0)

    session_id = data.get("session_id", "unknown")
    transcript_path = data.get("transcript_path", "")

    if not transcript_path:
        sys.exit(0)

    tp = Path(transcript_path)
    if not tp.exists():
        sys.exit(0)

    # Copy transcript to a temp file (flush.py cleans it up after use)
    try:
        tmp = tempfile.NamedTemporaryFile(
            suffix=".jsonl",
            prefix=f"claude-session-{session_id}-",
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
    env["CLAUDE_INVOKED_BY"] = "session_end_hook"

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
