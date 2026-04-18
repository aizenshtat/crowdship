#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="${REPO_ROOT}/migrations"
MIGRATIONS_TABLE="${MIGRATIONS_TABLE:-crowdship_schema_migrations}"
POSTGRES_CLIENT_IMAGE="${POSTGRES_CLIENT_IMAGE:-postgres:16-alpine}"
POSTGRES_CLIENT_DOCKER_NETWORK_MODE="${POSTGRES_CLIENT_DOCKER_NETWORK_MODE:-host}"
API_ENV_FILE="${API_ENV_FILE:-/etc/crowdship/crowdship-api.env}"

load_api_env() {
    if [[ -f "$API_ENV_FILE" ]]; then
        set -a
        # shellcheck disable=SC1090
        source "$API_ENV_FILE"
        set +a
    fi
}

if [[ -z "${DATABASE_URL:-}" ]]; then
    load_api_env
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is required to run Postgres migrations." >&2
    exit 1
fi

PSQL_MODE=""
if command -v psql >/dev/null 2>&1; then
    PSQL_MODE="local"
elif command -v docker >/dev/null 2>&1; then
    if ! docker info >/dev/null 2>&1; then
        echo "psql is not installed and docker is not available to run a temporary Postgres client." >&2
        exit 1
    fi
    PSQL_MODE="docker"
    echo "psql is unavailable; using Docker image ${POSTGRES_CLIENT_IMAGE} for the Postgres client on network ${POSTGRES_CLIENT_DOCKER_NETWORK_MODE}." >&2
else
    echo "psql is not installed and docker is unavailable for fallback." >&2
    exit 1
fi

run_psql() {
    if [[ "$PSQL_MODE" == "local" ]]; then
        psql -v ON_ERROR_STOP=1 -X "$DATABASE_URL" "$@"
    else
        docker run --rm -i --network "$POSTGRES_CLIENT_DOCKER_NETWORK_MODE" -e DATABASE_URL "$POSTGRES_CLIENT_IMAGE" \
            psql -v ON_ERROR_STOP=1 -X "$DATABASE_URL" "$@"
    fi
}

sql_quote() {
    local value="${1//\'/\'\'}"
    printf "'%s'" "$value"
}

shopt -s nullglob
migration_files=("${MIGRATIONS_DIR}"/*.sql)
shopt -u nullglob

if [[ ${#migration_files[@]} -eq 0 ]]; then
    echo "No migrations found in ${MIGRATIONS_DIR}."
    exit 0
fi

IFS=$'\n' migration_files=($(printf '%s\n' "${migration_files[@]}" | sort))
unset IFS

run_psql <<SQL
CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

declare -A applied_migrations=()
while IFS= read -r migration_name; do
    [[ -n "$migration_name" ]] || continue
    applied_migrations["$migration_name"]=1
done < <(run_psql -tA -c "SELECT filename FROM ${MIGRATIONS_TABLE} ORDER BY filename;")

applied_count=0
for migration_file in "${migration_files[@]}"; do
    migration_name="$(basename "$migration_file")"

    if [[ -n "${applied_migrations[$migration_name]:-}" ]]; then
        echo "Skipping already-applied migration ${migration_name}"
        continue
    fi

    echo "Applying migration ${migration_name}"
    {
        printf 'BEGIN;\n'
        cat "$migration_file"
        printf '\nINSERT INTO %s (filename) VALUES (%s);\n' \
            "$MIGRATIONS_TABLE" "$(sql_quote "$migration_name")"
        printf 'COMMIT;\n'
    } | run_psql

    applied_migrations["$migration_name"]=1
    applied_count=$((applied_count + 1))
done

echo "Migration run complete. Applied ${applied_count} migration(s)."
