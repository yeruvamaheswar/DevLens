#!/usr/bin/env bash
# Resets the real sprintboard-demo checkout to the `starter` tag and reseeds the DB.
# Usage: reset.sh [path-to-sprintboard-demo]
set -euo pipefail

repo="${1:-$(cd "$(dirname "$0")/../../.." && pwd)/sprintboard-demo}"

if [ ! -d "$repo" ] || [ "$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null)" != "$(cd "$repo" && pwd -P)" ]; then
  echo "Refusing: $repo is not the root of a git repo." >&2
  exit 1
fi
if ! grep -q '"name": "sprintboard-demo"' "$repo/package.json" 2>/dev/null; then
  echo "Refusing: $repo is not the sprintboard-demo repo." >&2
  exit 1
fi
if ! git -C "$repo" rev-parse --verify --quiet refs/tags/starter >/dev/null; then
  echo "Refusing: tag 'starter' not found in $repo." >&2
  exit 1
fi

cd "$repo"
git checkout -f starter -- .
# Remove only untracked files inside app paths. data/ is not listed, and git clean skips ignored files.
git clean -fd -- src public test migrations server.js package.json README.md .gitignore
npm run seed --silent
git status --short
echo "sprintboard-demo is back at the starter state."
