from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
DAILY_DIR = ROOT_DIR / "daily"
KNOWLEDGE_DIR = ROOT_DIR / "knowledge"
SCRIPTS_DIR = ROOT_DIR / "scripts"
HOOKS_DIR = ROOT_DIR / "hooks"
REPORTS_DIR = ROOT_DIR / "reports"

STATE_FILE = SCRIPTS_DIR / "state.json"
LAST_FLUSH_FILE = SCRIPTS_DIR / "last-flush.json"

COMPILE_AFTER_HOUR = 18  # 6 PM local time triggers end-of-day auto-compile
FLUSH_DEDUP_SECONDS = 60  # ignore flushes for the same session within this window
MAX_SESSION_CONTEXT_CHARS = 20_000
