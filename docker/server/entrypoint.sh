#!/usr/bin/env bash
set -euo pipefail

# Entrypoint for app container — optionally run setup-db script once on first start
# Environment variables used:
#  - RUN_SETUP_DB_ON_START: 'false' disables the setup run; anything else (or unset) runs setup-db
#  - INPUT_FILE: if set, setup-db will attempt to import JSONL as well
# The script writes a marker file /app/.setup_done to avoid repeating the setup on subsequent restarts.

MARKER_FILE="${MARKER_FILE:-/app/data/.setup_done}"

# Run the setup step only if marker doesn't exist and RUN_SETUP_DB_ON_START != 'false'
if [ "${RUN_SETUP_DB_ON_START-}" != "false" ] && [ ! -f "$MARKER_FILE" ]; then
  # print the effective DB connection target (mask password if using DATABASE_URL)
  if [ -n "${DATABASE_URL-}" ]; then
    # mask password in DATABASE_URL for logs
    masked=$(echo "${DATABASE_URL}" | sed -E 's/:(.*)@/:****@/')
    echo "[entrypoint] Running initial DB setup using DATABASE_URL=${masked}"
  else
    echo "[entrypoint] Running initial DB setup (PGHOST=${PGHOST:-<unset>} PGPORT=${PGPORT:-<unset>})"
  fi
  # run as the same user (assume the container uses 'node' user) — keep sets in place
  if command -v node >/dev/null 2>&1; then
    if node scripts/setup-db.mjs; then
      # Ensure parent directory exists; try to create but don't die if it fails
      mkdir -p "$(dirname "$MARKER_FILE")" 2>/dev/null || true
      if touch "$MARKER_FILE" 2>/dev/null; then
        echo "[entrypoint] DB setup complete, marker created"
      else
        # It's common for bind-mounted host paths to be owned by root.
        # Don't fail container startup — warn the operator and continue.
        echo "[entrypoint] WARNING: unable to create marker file '$MARKER_FILE' — permission denied or read-only mount." >&2
        echo "[entrypoint] Hint: ensure the mount (host path) is writable by the container runtime user (typically the 'node' user)," >&2
        echo "[entrypoint] or set MARKER_FILE to a writable path (e.g. /tmp/.setup_done) or disable RUN_SETUP_DB_ON_START." >&2
      fi
    else
      echo "[entrypoint] setup-db failed — container will continue to start (app may not be functional)." >&2
      if [ "${PGHOST-}" = "127.0.0.1" ] || [ "${PGHOST-}" = "localhost" ]; then
        echo "[entrypoint] Hint: PGHOST is set to '${PGHOST}'. In containerized environments this often points to the container itself and will fail to reach a host-level DB. Prefer using DATABASE_URL or set PGHOST to the actual DB host/service name (e.g., 'postgres')." >&2
      fi
    fi
    # marker already handled inside the if/else above
  else
    echo "[entrypoint] node not found in PATH — skipping setup-db" >&2
  fi
else
  if [ -f "$MARKER_FILE" ]; then
    echo "[entrypoint] setup already performed (marker present) — skipping"
  else
    echo "[entrypoint] RUN_SETUP_DB_ON_START is 'false' — skipping setup-db"
  fi
fi

# exec the original CMD (node server.mjs)
exec "$@"
