#!/usr/bin/env bash
set -euo pipefail

# docker-pg-dump.sh
# Convenience wrapper that runs pg_dump inside your `postgres` service
# from docker-compose and writes a custom-format dump to the host.
#
# Usage examples:
#   ./scripts/docker-pg-dump.sh -o /tmp/ragdump.dump
#   ./scripts/docker-pg-dump.sh -s postgres -u postgres -d ragdb -o ./dumps/rag.dump
#   ./scripts/docker-pg-dump.sh -f docker-compose.yml -o ./dumps/rag.dump

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  -s, --service SERVICE   Docker compose service name (default: postgres)
  -u, --user USER         DB username to use for pg_dump (default: postgres)
  -d, --db DBNAME         Database name to dump (default: PGDATABASE or ragdb)
  -o, --out PATH          Output file path on host (default: ./dumps/rag-YYYYMMDDHHMM.dump.gz)
  --no-compress          Do not gzip the output (produce raw .dump)
  -f, --compose FILE      docker-compose file to pass to 'docker compose -f'
  -h, --help              Show this help

This script uses `docker compose exec -T` to run pg_dump inside the container
and streams the output to the given file on the host. The service must be running.
EOF
}

err(){ echo "Error: $*" >&2; exit 1; }

# Detect docker compose binary (docker compose or docker-compose)
detect_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  else
    return 1
  fi
}

COMPOSE_CMD=$(detect_compose || true)
if [[ -z "$COMPOSE_CMD" ]]; then
  err "docker compose or docker-compose is required but not found in PATH"
fi

# Load PG* variables from .env if present (but don't execute arbitrary commands)
if [[ -f ".env" ]]; then
  # Read exported vars like: export PGHOST=postgres
  while IFS='=' read -r k v; do
    # normalize 'export ' prefix and whitespace
    k=$(echo "${k}" | sed -E 's/^\s*export\s+//' | tr -d ' \t')
    case "$k" in
      PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|DATABASE_URL)
        # strip surrounding quotes if present
        v=$(echo "$v" | sed -E 's/^\s*"?//; s/"?\s*$//')
        # only export if variable not already set in env
        if [[ -z "${!k:-}" ]]; then
          export "$k"="$v"
        fi
        ;;
    esac
  done < <(grep -E '^\s*(export\s+)?(PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|DATABASE_URL)=' .env || true)
fi

# defaults
SERVICE="postgres"
USER_NAME="postgres"
# Always use PGDATABASE as the canonical source of truth for which DB to dump.
# If user supplies -d/--db we set PGDATABASE accordingly. If PGDATABASE is absent
# (in env/.env) we fail fast and instruct how to fix it.
DBNAME="${PGDATABASE:-}"
DBNAME_SET_BY_ARG=0
OUT=""
COMPOSE_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--service) SERVICE="$2"; shift 2 ;;
    -u|--user) USER_NAME="$2"; shift 2 ;;
    -d|--db) DBNAME="$2"; DBNAME_SET_BY_ARG=1; PGDATABASE="$2"; shift 2 ;;
    -o|--out) OUT="$2"; shift 2 ;;
    --no-compress) COMPRESS=0; shift ;;
    -f|--compose) COMPOSE_FILE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) err "Unknown argument: $1" ;;
  esac
done

COMPRESS=${COMPRESS:-1}

if [[ -z "$OUT" ]]; then
  ts=$(date +%Y%m%d%H%M)
  mkdir -p ./dumps
  if [[ "$COMPRESS" -eq 1 ]]; then
    OUT="./dumps/${DBNAME}-${ts}.dump.gz"
  else
    OUT="./dumps/${DBNAME}-${ts}.dump"
  fi
fi

echo "Using docker compose: $COMPOSE_CMD"
if [[ -n "$COMPOSE_FILE" ]]; then
  echo "Compose file: $COMPOSE_FILE"
  # Append compose file to the command string; we'll assemble a final command via eval
  COMPOSE_FILE_OPTS="-f $COMPOSE_FILE"
fi

# Require PGDATABASE to be set (either in env/.env or via -d/--db). This keeps
# the behavior explicit and avoids ambiguous fallbacks.
if [[ -z "${DBNAME:-}" ]]; then
  err "PGDATABASE is not set. Please set PGDATABASE in your environment (e.g. .env) or pass -d/--db to select the database to dump."
fi

echo "Service: $SERVICE  DB: $DBNAME  User: $USER_NAME  -> $OUT"

# Quick check — service must be running in compose
if ! $COMPOSE_CMD ps --services --status running | grep -q "^$SERVICE$" 2>/dev/null; then
  echo "Warning: service '$SERVICE' doesn't appear to be running. Starting it may be necessary."
fi

mkdir -p "$(dirname "$OUT")"

echo "Dumping database $DBNAME from service $SERVICE to $OUT (compress=$COMPRESS)"

# Run pg_dump inside container; -T disables tty so we can redirect to host
set -o pipefail

# Build environment flags to ensure non-interactive auth (if PGPASSWORD present)
EXEC_ENV_OPTS=""
if [[ -n "${PGPASSWORD:-}" ]]; then
  EXEC_ENV_OPTS="$EXEC_ENV_OPTS -e PGPASSWORD=${PGPASSWORD}"
fi
if [[ -n "${PGUSER:-}" ]]; then
  EXEC_ENV_OPTS="$EXEC_ENV_OPTS -e PGUSER=${PGUSER}"
fi
if [[ -n "${PGDATABASE:-}" ]]; then
  EXEC_ENV_OPTS="$EXEC_ENV_OPTS -e PGDATABASE=${PGDATABASE}"
fi

# Prepare and run the final docker compose exec command
if [[ -n "${COMPOSE_FILE_OPTS:-}" ]]; then
  CMD_STR="$COMPOSE_CMD $COMPOSE_FILE_OPTS exec -T $EXEC_ENV_OPTS $SERVICE pg_dump -U $USER_NAME -Fc $DBNAME"
else
  CMD_STR="$COMPOSE_CMD exec -T $EXEC_ENV_OPTS $SERVICE pg_dump -U $USER_NAME -Fc $DBNAME"
fi
echo "Running: $CMD_STR"

# Before running pg_dump, check that the DB exists inside the container. This helps
# avoid confusing errors when the host env and .env disagree about DB name.
if [[ -n "${COMPOSE_FILE_OPTS:-}" ]]; then
  base_cmd="$COMPOSE_CMD $COMPOSE_FILE_OPTS exec -T $EXEC_ENV_OPTS $SERVICE"
else
  base_cmd="$COMPOSE_CMD exec -T $EXEC_ENV_OPTS $SERVICE"
fi

# Query inside container for the DB existence
check_cmd="$base_cmd psql -d postgres -Atc \"SELECT 1 FROM pg_database WHERE datname='$DBNAME'\""
exists=$(eval "$check_cmd" 2>/dev/null || true)
if [[ "${exists:-}" != "1" ]]; then
  echo "Error: database '$DBNAME' not found inside service '$SERVICE'. Listing available databases for troubleshooting:" >&2
  # Show readable list
  list_cmd="$base_cmd psql -d postgres -c \"\\l\""
  eval "$list_cmd" >&2 || true
  err "Database '$DBNAME' not found. Set correct DB with -d/--db or ensure .env/DATABASE_URL/PGDATABASE is correct."
fi

if [[ "$COMPRESS" -eq 1 ]]; then
  # stream through gzip to compress the custom-format dump
  eval $CMD_STR | gzip -c > "$OUT"
else
  eval $CMD_STR > "$OUT"
fi

echo "Dump written: $OUT"
