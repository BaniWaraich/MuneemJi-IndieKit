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
from datetime import datetime
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent

# Log file so silent exits are diagnosable
_LOG_PATH = ROOT_DIR / "hooks" / "session-end.log"


def _log(msg: str) -> None:
    try:
        with _LOG_PATH.open("a", encoding="utf-8", buffering=1) as f:
            f.write(f"[{datetime.now().isoformat()}] {msg}\n")
    except Exception:
        pass


def _find_transcript_fallback(session_id: str) -> Path | None:
    """
    Fallback for Claude Code bug #13668: transcript_path may be absent from
    the SessionEnd payload. Walk ~/.claude/projects/<project-slug>/ and find
    the .jsonl file whose stem matches the session_id.
    """
    project_slug = "-".join(str(ROOT_DIR).replace("/", "-").lstrip("-").split())
    # Normalise: /Users/baniwaraich/Desktop/Indie Kit/indie-kit
    # → -Users-baniwaraich-Desktop-Indie-Kit-indie-kit
    slug = str(ROOT_DIR).replace("/", "-").replace(" ", "-").lstrip("-")
    candidates = [
        Path.home() / ".claude" / "projects" / slug,
        Path.home() / ".claude" / "projects" / project_slug,
    ]
    for base in candidates:
        if not base.exists():
            continue
        # Exact match by session_id first
        exact = base / f"{session_id}.jsonl"
        if exact.exists() and exact.stat().st_size > 0:
            return exact
        # Fallback: most recently modified .jsonl in the directory
        jsonl_files = sorted(base.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
        for f in jsonl_files:
            if f.stat().st_size > 0:
                return f
    return None


def main() -> None:
    # Recursion guard: flush.py sets this before invoking Claude SDK
    if os.environ.get("CLAUDE_INVOKED_BY"):
        sys.exit(0)

    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        _log(f"ERROR: failed to parse stdin: {e}")
        sys.exit(0)

    session_id = data.get("session_id", "unknown")
    transcript_path = data.get("transcript_path", "")

    _log(f"session_id={session_id} transcript_path={transcript_path!r}")

    if not transcript_path:
        _log("transcript_path empty — trying fallback locator (bug #13668)")
        fallback = _find_transcript_fallback(session_id)
        if fallback:
            _log(f"fallback found: {fallback}")
            transcript_path = str(fallback)
        else:
            _log("fallback not found — exiting")
            sys.exit(0)

    tp = Path(transcript_path)
    if not tp.exists() or tp.stat().st_size == 0:
        _log(f"transcript not usable (exists={tp.exists()}, size={tp.stat().st_size if tp.exists() else 'n/a'}) — exiting")
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
    except Exception as e:
        _log(f"ERROR: failed to copy transcript: {e}")
        sys.exit(0)

    _log(f"spawning flush.py with {tmp_path}")
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
