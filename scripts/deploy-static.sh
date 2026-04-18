#!/usr/bin/env bash
set -euo pipefail

APP_DOMAIN="crowdship.aizenshtat.eu"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="/var/www/${APP_DOMAIN}/html"
BUILD_DIR="${REPO_ROOT}/dist"
API_SERVICE="crowdship-api.service"
WORKER_SERVICE="crowdship-worker.service"
API_ENV_FILE="${API_ENV_FILE:-/etc/crowdship/crowdship-api.env}"
MIGRATION_SCRIPT="${REPO_ROOT}/scripts/run-migrations.sh"

load_api_env() {
    if [[ -f "$API_ENV_FILE" ]]; then
        set -a
        # shellcheck disable=SC1090
        source "$API_ENV_FILE"
        set +a
    fi
}

npm run build

install -d -m 755 "$TARGET"
rsync -a --delete "${BUILD_DIR}/" "$TARGET/"
find "$TARGET" -type d -exec chmod 755 {} \;
find "$TARGET" -type f -exec chmod 644 {} \;

if [[ -z "${DATABASE_URL:-}" ]]; then
    load_api_env
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
    "$MIGRATION_SCRIPT"
else
    echo "Skipping Postgres migrations; DATABASE_URL is not configured."
fi

if systemctl cat "$API_SERVICE" >/dev/null 2>&1; then
    systemctl restart "$API_SERVICE"
else
    echo "Skipping ${API_SERVICE}; unit is not installed."
fi

if systemctl cat "$WORKER_SERVICE" >/dev/null 2>&1; then
    systemctl restart "$WORKER_SERVICE"
else
    echo "Skipping ${WORKER_SERVICE}; unit is not installed."
fi

echo "Published ${APP_DOMAIN} to ${TARGET}"
