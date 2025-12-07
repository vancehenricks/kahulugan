#!/usr/bin/env bash
set -euo pipefail

# docker-pg-restore.sh
# Restore a Postgres custom-format dump file (.dump or .dump.gz) into the
# postgres service in docker-compose. Reads defaults from .env.
#
# Usage:
#   ./scripts/docker-pg-restore.sh -i /tmp/rag.dump.gz
#   ./scripts/docker-pg-restore.sh -i ./dumps/rag.dump.gz --create-db
#
usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  -i, --in PATH          Input dump file (.dump or .dump.gz) [required]
  -d, --db DBNAME        Database name to restore into (sets PGDATABASE for this run)
  --create-db            Allow restore to create DB (use pg_restore -C)
  -s, --service SERVICE  Docker compose service name (default: postgres). Can also be a
                         direct container id or container name to execute against.
  -u, --user USER        DB username inside container (default: postgres)
  -f, --compose FILE     docker-compose file to pass to 'docker compose -f'
  --drop-db             Drop the target database (or objects) before restore.
                         When used with --create-db this will DROP DATABASE
                         IF EXISTS and allow restore to recreate it. Without
                         --create-db the script will pass pg_restore --clean
  -h, --help             Show this help

This script streams the local dump into the postgres container and runs
pg_restore (custom-format) or pg_restore when decompressing on the host.
EOF
}

err(){ echo "Error: $*" >&2; exit 1; }

# Detect docker compose binary
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
  err "docker compose or docker-compose required"
fi

# load .env lines for PG* vars
if [[ -f ".env" ]]; then
  while IFS='=' read -r k v; do
    k=$(echo "${k}" | sed -E 's/^\s*export\s+//' | tr -d ' \t')
    case "$k" in
      PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|DATABASE_URL)
        v=$(echo "$v" | sed -E 's/^\s*"?//; s/"?\s*$//')
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
INFILE=""
DBNAME="${PGDATABASE:-}"
CREATE_DB=0
COMPOSE_FILE=""
MAINTENANCE_MEM=""
DROP_DB=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -i|--in) INFILE="$2"; shift 2 ;;
    -d|--db) DBNAME="$2"; PGDATABASE="$2"; shift 2 ;;
    --create-db) CREATE_DB=1; shift ;;
    -s|--service) SERVICE="$2"; shift 2 ;;
    -u|--user) USER_NAME="$2"; shift 2 ;;
    -f|--compose) COMPOSE_FILE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    --maintenance-mem|--maintenance-work-mem) MAINTENANCE_MEM="$2"; shift 2 ;;
    --drop-db) DROP_DB=1; shift ;;
    *) err "Unknown arg: $1" ;;
  esac
done

if [[ -z "$INFILE" ]]; then
  usage; err "-i/--in is required (path to .dump or .dump.gz)";
fi

if [[ ! -f "$INFILE" ]]; then
  err "Input file not found: $INFILE"
fi

if [[ -z "${DBNAME:-}" ]]; then
  err "PGDATABASE is not set and no -d/--db provided. Set PGDATABASE in .env or pass -d.";
fi

echo "Using docker compose: $COMPOSE_CMD"
if [[ -n "$COMPOSE_FILE" ]]; then
  COMPOSE_CMD="$COMPOSE_CMD -f $COMPOSE_FILE"
  echo "Compose file: $COMPOSE_FILE"
fi

echo "Restore options: service=$SERVICE db=$DBNAME user=$USER_NAME infile=$INFILE create_db=$CREATE_DB"

# Build exec env flags
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

# Ensure the target DB exists unless create_db mode
if [[ $CREATE_DB -eq 0 ]]; then
  echo "Checking target DB '$DBNAME' exists inside container..."
  check_cmd="$COMPOSE_CMD exec -T $SERVICE psql -U $USER_NAME -d postgres -Atc \"SELECT 1 FROM pg_database WHERE datname='$DBNAME'\""
  exists=$(eval "$check_cmd" 2>/dev/null || true)
  if [[ "${exists:-}" != "1" ]]; then
    err "Target database '$DBNAME' not found inside container. Use --create-db to allow creation or ensure DB exists."
  fi
fi

# If input is gzipped, stream through gzip -dc; else stream raw
case "$INFILE" in
  *.gz) decompress_cmd="gzip -dc $INFILE" ;;
  *) decompress_cmd="cat $INFILE" ;;
esac

# Compose command to run pg_restore inside container. When using --create-db, we
# connect to postgres db and allow pg_restore -C to create the DB from the dump.
if [[ $CREATE_DB -eq 1 ]]; then
  restore_inner_cmd="pg_restore -U $USER_NAME -C -d postgres --verbose"
else
  restore_inner_cmd="pg_restore -U $USER_NAME -d $DBNAME --verbose"
fi

# If user set maintenance memory, wrap the restore command with PGOPTIONS so
# pg_restore will run in a session with increased maintenance_work_mem.
if [[ -n "${MAINTENANCE_MEM:-}" ]]; then
  # wrap under sh -c so both docker exec and compose exec can run it
  restore_with_mem="sh -c \"PGOPTIONS='--maintenance_work_mem=${MAINTENANCE_MEM}' $restore_inner_cmd\""
else
  restore_with_mem="$restore_inner_cmd"
fi

# If requested, and not using --create-db, enable pg_restore --clean so
# existing objects are removed before re-creating them. If using --create-db
# together with --drop-db we will drop the DB first to allow a clean create.
if [[ $DROP_DB -eq 1 && $CREATE_DB -eq 0 ]]; then
  # add --clean (same as -c) to command so pg_restore drops existing objects
  # before recreating them.
  restore_inner_cmd="pg_restore -c -U $USER_NAME -d $DBNAME --verbose"
  # ensure wrapper uses the final command
  if [[ -n "${MAINTENANCE_MEM:-}" ]]; then
    restore_with_mem="sh -c \"PGOPTIONS='--maintenance_work_mem=${MAINTENANCE_MEM}' $restore_inner_cmd\""
  else
    restore_with_mem="$restore_inner_cmd"
  fi
fi

# Choose the best exec method. Prefer `docker compose exec` when the service is
# a compose-managed service and has a running container. If compose can't find
# the service or the service is not running (common when user passed a plain
# container name or id), fall back to `docker exec` on the container id/name.
use_docker_exec=0
container_id=""

# Try to find compose-managed container id for the service
compose_container_id=$(eval "$COMPOSE_CMD ps -q $SERVICE" 2>/dev/null || true)
if [[ -n "${compose_container_id:-}" ]]; then
  # we found a running container for that compose service — keep using compose
  final_cmd="$COMPOSE_CMD exec -T $EXEC_ENV_OPTS $SERVICE $restore_with_mem"
else
  # No compose-managed container — check if the user passed an actual
  # container id or container name visible to plain `docker ps`.
  container_id=$(docker ps -q --filter "name=$SERVICE" 2>/dev/null || true)
  if [[ -z "${container_id:-}" ]]; then
    # Maybe they passed an id directly, try matching by id
    container_id=$(docker ps -q --filter "id=$SERVICE" 2>/dev/null || true)
  fi

  if [[ -n "${container_id:-}" ]]; then
    # Use docker exec with the same environment flags we built earlier
    echo "Compose service not found — falling back to docker exec container=$container_id"
    # docker exec expects -i/-T and supports -e for env vars; we'll use -i
    final_cmd="docker exec -i $EXEC_ENV_OPTS $container_id $restore_with_mem"
    use_docker_exec=1
  else
    # No container id found — we'll try compose exec and let it report useful errors
    final_cmd="$COMPOSE_CMD exec -T $EXEC_ENV_OPTS $SERVICE $restore_with_mem"
  fi
fi

# If user asked to drop DB before restoring (and we're doing a create), run
# admin steps to terminate connections and drop the DB so pg_restore -C can
# create it cleanly.
if [[ $DROP_DB -eq 1 && $CREATE_DB -eq 1 ]]; then
  echo "--drop-db set + --create-db set: dropping database '$DBNAME' before restore"
  # termination SQL
  term_sql="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DBNAME}' AND pid<>pg_backend_pid();"
  drop_sql="DROP DATABASE IF EXISTS \"${DBNAME}\";"

  if [[ $use_docker_exec -eq 1 ]]; then
    echo "Running termination & drop on container $container_id"
    docker exec -i $EXEC_ENV_OPTS $container_id sh -c "psql -U $USER_NAME -d postgres -c \"$term_sql\" && psql -U $USER_NAME -d postgres -c \"$drop_sql\""
  else
    echo "Running termination & drop on compose service $SERVICE"
    $COMPOSE_CMD exec -T $EXEC_ENV_OPTS $SERVICE sh -c "psql -U $USER_NAME -d postgres -c \"$term_sql\" && psql -U $USER_NAME -d postgres -c \"$drop_sql\""
  fi
fi

echo "Restoring: streaming $INFILE -> $SERVICE as user=$USER_NAME (create_db=$CREATE_DB)"
set -o pipefail
if [[ $use_docker_exec -eq 1 ]]; then
  # docker exec uses -i for stdin; we already built final_cmd accordingly
  eval $decompress_cmd | eval $final_cmd
else
  # compose exec — same streaming behavior
  eval $decompress_cmd | eval $final_cmd
fi

echo "Restore finished"
