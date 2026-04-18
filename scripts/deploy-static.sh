#!/usr/bin/env bash
set -euo pipefail

APP_DOMAIN="crowdship.aizenshtat.eu"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="/var/www/${APP_DOMAIN}/html"
BUILD_DIR="${REPO_ROOT}/dist"
API_SERVICE="crowdship-api.service"

npm run build

install -d -m 755 "$TARGET"
rsync -a --delete "${BUILD_DIR}/" "$TARGET/"
find "$TARGET" -type d -exec chmod 755 {} \;
find "$TARGET" -type f -exec chmod 644 {} \;

if systemctl cat "$API_SERVICE" >/dev/null 2>&1; then
    systemctl restart "$API_SERVICE"
else
    echo "Skipping ${API_SERVICE}; unit is not installed."
fi

echo "Published ${APP_DOMAIN} to ${TARGET}"
