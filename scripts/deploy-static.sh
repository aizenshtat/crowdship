#!/usr/bin/env bash
set -euo pipefail

APP_DOMAIN="crowdship.aizenshtat.eu"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="/var/www/${APP_DOMAIN}/html"

install -d -m 755 "$TARGET"
rsync -a --delete "${REPO_ROOT}/public/" "$TARGET/"
find "$TARGET" -type d -exec chmod 755 {} \;
find "$TARGET" -type f -exec chmod 644 {} \;

echo "Published ${APP_DOMAIN} to ${TARGET}"
