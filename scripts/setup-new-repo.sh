#!/usr/bin/env bash
# Bootstraps claude-bugbot into a new project repo.
#
# Usage:
#   ./setup-new-repo.sh /path/to/new/project
#
# Requires: gh CLI logged in, and the following env vars set in your shell
# (or in a .env.bugbot file in this directory, which will be sourced):
#   CLAUDE_CODE_OAUTH_TOKEN, TELEGRAM_BOT_TOKEN, BUGBOT_INTERNAL_SECRET, BUGBOT_WORKER_URL
set -euo pipefail

TARGET_DIR="${1:?Usage: ./setup-new-repo.sh /path/to/new/project}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$SCRIPT_DIR/.env.bugbot" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env.bugbot"
fi

: "${CLAUDE_CODE_OAUTH_TOKEN:?Set CLAUDE_CODE_OAUTH_TOKEN (from: claude setup-token)}"
: "${TELEGRAM_BOT_TOKEN:?Set TELEGRAM_BOT_TOKEN}"
: "${BUGBOT_INTERNAL_SECRET:?Set BUGBOT_INTERNAL_SECRET}"
: "${BUGBOT_WORKER_URL:?Set BUGBOT_WORKER_URL (e.g. https://claude-bugbot.<you>.workers.dev)}"

mkdir -p "$TARGET_DIR/.github/workflows" "$TARGET_DIR/.github/scripts"

cp "$REPO_ROOT/templates/bugbot.yml" "$TARGET_DIR/.github/workflows/bugbot.yml"
cp "$REPO_ROOT/templates/bugbot-create-pr.yml" "$TARGET_DIR/.github/workflows/bugbot-create-pr.yml"
cp "$REPO_ROOT/templates/bugbot-cleanup.yml" "$TARGET_DIR/.github/workflows/bugbot-cleanup.yml"
cp "$REPO_ROOT/scripts/screenshot.mjs" "$TARGET_DIR/.github/scripts/screenshot.mjs"
cp "$REPO_ROOT/scripts/notify-fix-ready.mjs" "$TARGET_DIR/.github/scripts/notify-fix-ready.mjs"

echo "Copied workflow + script files into $TARGET_DIR"

cd "$TARGET_DIR"
gh secret set CLAUDE_CODE_OAUTH_TOKEN --body "$CLAUDE_CODE_OAUTH_TOKEN"
gh secret set TELEGRAM_BOT_TOKEN --body "$TELEGRAM_BOT_TOKEN"
gh secret set BUGBOT_INTERNAL_SECRET --body "$BUGBOT_INTERNAL_SECRET"
gh secret set BUGBOT_WORKER_URL --body "$BUGBOT_WORKER_URL"

echo ""
echo "Done. Don't forget to:"
echo "  1. Add 'playwright' and 'wait-on' as devDependencies (npm install -D playwright wait-on)"
echo "  2. Adjust dev_url / dev_command in .github/workflows/bugbot.yml if this project"
echo "     doesn't run 'npm run dev' on http://localhost:3000"
echo "  3. Commit and push the .github/ changes"
