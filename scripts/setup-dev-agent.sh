#!/bin/bash
# One-time setup for the NanoClaw dev-agent (Argos project).
# Run this once after setting GITHUB_TOKEN in .env.
# Safe to re-run — checks before overwriting.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NANOCLAW_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="/opt/argos"
DEV_KEYS_DIR="/opt/dev-keys"
ALLOWLIST_DIR="${HOME}/.config/nanoclaw"
ALLOWLIST_PATH="${ALLOWLIST_DIR}/mount-allowlist.json"
STORE_DIR="${NANOCLAW_DIR}/store"
GITHUB_REPO="https://github.com/aarongraham/argos.git"

# ── Load GITHUB_TOKEN from .env ─────────────────────────────────────────────
ENV_FILE="${NANOCLAW_DIR}/.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^GITHUB_TOKEN=' "$ENV_FILE" | xargs) 2>/dev/null || true
fi

if [ -z "$GITHUB_TOKEN" ]; then
  echo ""
  echo "Error: GITHUB_TOKEN is not set."
  echo "Add it to .env: GITHUB_TOKEN=github_pat_..."
  echo ""
  echo "Create one at: GitHub → Settings → Developer settings → Fine-grained tokens"
  echo "Permissions: Contents → Read and Write (scoped to argos repo only)"
  exit 1
fi

echo "=== NanoClaw Dev Agent Setup ==="
echo ""

# ── 1. Clone the project ─────────────────────────────────────────────────────
if [ -d "${PROJECT_DIR}/.git" ]; then
  echo "[1/6] Project already cloned at ${PROJECT_DIR} — skipping clone"
else
  echo "[1/6] Cloning argos to ${PROJECT_DIR}..."
  sudo mkdir -p "$PROJECT_DIR"
  sudo chown "$USER:$USER" "$PROJECT_DIR"
  git clone "https://x-access-token:${GITHUB_TOKEN}@${GITHUB_REPO#https://}" "$PROJECT_DIR"
fi

# ── 2. Configure git credentials for container pushes ────────────────────────
echo "[2/6] Configuring git remote with push credentials..."
cd "$PROJECT_DIR"
# Embed token in remote URL — stored in .git/config, persists across container runs.
# The container's git config uses this automatically on every push.
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@${GITHUB_REPO#https://}"
echo "      Remote configured. Token is embedded in .git/config (stays within this server)."

# ── 3. Postgres ───────────────────────────────────────────────────────────────
# argos_dev lives in the existing onecli-postgres-1 container (already on :5432).
# The user and database were created once during initial setup.
echo "[3/6] Verifying argos_dev database exists in onecli-postgres-1..."
if docker exec onecli-postgres-1 psql -U onecli -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw argos_dev; then
  echo "      argos_dev exists — OK"
else
  echo "      argos_dev not found — creating user and database..."
  PG_PASSWORD=$(openssl rand -base64 18 | tr -dc 'a-zA-Z0-9' | head -c 24)
  docker exec onecli-postgres-1 psql -U onecli -c "CREATE USER argos WITH PASSWORD '${PG_PASSWORD}';"
  docker exec onecli-postgres-1 psql -U onecli -c "CREATE DATABASE argos_dev OWNER argos;"
  echo ""
  echo "      Database created. Connection URL:"
  echo "      ecto://argos:${PG_PASSWORD}@host.docker.internal:5432/argos_dev"
  echo ""
  echo "      Add the hostname/username/password to config/dev.exs in the argos project."
fi

# ── 4. Mount allowlist ────────────────────────────────────────────────────────
echo "[4/6] Configuring mount allowlist at ${ALLOWLIST_PATH}..."
mkdir -p "$ALLOWLIST_DIR"

if [ -f "$ALLOWLIST_PATH" ]; then
  echo "      Allowlist already exists — skipping (edit manually if needed)"
else
  cat > "$ALLOWLIST_PATH" << EOF
{
  "allowedRoots": [
    {
      "path": "${PROJECT_DIR}",
      "allowReadWrite": true,
      "description": "Argos Elixir project (dev-agent read-write access)"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": false
}
EOF
  echo "      Allowlist created."
fi

# ── 5. Build the dev-agent container image ───────────────────────────────────
echo "[5/6] Building nanoclaw-dev-agent Docker image..."
echo "      (This takes 10-20 minutes the first time — Erlang compiles from source)"
echo ""
"${NANOCLAW_DIR}/container/build-dev-agent.sh"

# ── 6. Register the group in NanoClaw's database ─────────────────────────────
echo ""
echo "[6/6] Registering dev-agent group in NanoClaw database..."
cd "$NANOCLAW_DIR"

if [ -z "$DEV_AGENT_TELEGRAM_CHAT_ID" ]; then
  echo ""
  echo "      Skipping group registration — DEV_AGENT_TELEGRAM_CHAT_ID not set."
  echo ""
  echo "      To find your Telegram chat ID:"
  echo "        1. Message your NanoClaw Telegram bot in the chat you want to use"
  echo "        2. The bot will print the chat ID in the message"
  echo "        3. Add DEV_AGENT_TELEGRAM_CHAT_ID=<id> to .env"
  echo "        4. Re-run this script (steps 1-5 will be skipped)"
else
  npx tsx scripts/register-dev-agent.ts "$DEV_AGENT_TELEGRAM_CHAT_ID"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. If you haven't yet, add GITHUB_TOKEN to .env"
if [ -z "$DEV_AGENT_TELEGRAM_CHAT_ID" ]; then
echo "  2. Add DEV_AGENT_TELEGRAM_CHAT_ID to .env, then re-run this script"
else
echo "  2. Restart NanoClaw: systemctl --user restart nanoclaw"
echo "  3. Send a message in your dev Telegram chat to test"
fi
