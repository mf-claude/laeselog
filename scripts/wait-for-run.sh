#!/usr/bin/env bash
# Waits for the GitHub Actions run of one workflow for one exact commit and
# exits with its result. "The newest run" is not good enough: GitHub can be
# slow to create a run, and then the newest one belongs to the previous commit.
#
# Usage: wait-for-run.sh <workflow-file> [commit-sha]   (default: HEAD)
#   e.g. wait-for-run.sh production-deploy.yml

set -euo pipefail

WORKFLOW="${1:?Usage: wait-for-run.sh <workflow-file> [commit-sha]}"
SHA="$(git rev-parse "${2:-HEAD}")"

echo "Waiting for $WORKFLOW run of ${SHA:0:7}..."
for _ in $(seq 1 60); do
  RUN_ID="$(gh run list --workflow "$WORKFLOW" --commit "$SHA" --limit 1 \
    --json databaseId --jq '.[0].databaseId // empty')"
  [ -n "$RUN_ID" ] && break
  sleep 10
done

if [ -z "${RUN_ID:-}" ]; then
  echo "No $WORKFLOW run for ${SHA:0:7} after 10 minutes." >&2
  echo "Start it by hand: gh workflow run $WORKFLOW --ref main" >&2
  exit 1
fi

gh run watch "$RUN_ID" --exit-status
