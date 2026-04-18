#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

mode="${1:-}"

if [[ "$mode" == "--staged" ]]; then
  git diff --cached --check
else
  git diff --check
fi

bash -n scripts/*.sh .githooks/pre-commit
node --test tests/*.test.mjs

tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

if git ls-files -z | xargs -0 -r grep -nE 's[k]-svcacct|s[n]tryu_|__[a]0_session|BEGIN (RSA|OPENSSH|PRIVATE) KEY|g[h]o_[A-Za-z0-9_]+|g[i]thub_pat_' >"$tmp_file" 2>/dev/null; then
  cat "$tmp_file" >&2
  echo "Potential secret detected in tracked files." >&2
  exit 1
fi
