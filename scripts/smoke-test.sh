#!/usr/bin/env bash
# Basic end-to-end smoke test for a deployed laeselog instance (preview or prod).
# Logs in, creates a book, verifies it, updates its page, deletes it, and
# confirms cleanup. Exits non-zero if any check fails.
#
# Usage: smoke-test.sh <base-url> <site-password>

set -euo pipefail

BASE_URL="${1:?Usage: smoke-test.sh <base-url> <site-password>}"
SITE_PASSWORD="${2:?Usage: smoke-test.sh <base-url> <site-password>}"
BASE_URL="${BASE_URL%/}"

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

pass=0
fail=0

check() {
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "ok   - $desc"
    pass=$((pass + 1))
  else
    echo "FAIL - $desc (expected '$expected', got '$actual')"
    fail=$((fail + 1))
  fi
}

# api <method> <api-path> [json-body]
# Prints response body followed by a newline and the HTTP status code.
api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" \
      -H 'Content-Type: application/json' -d "$body" \
      -w '\n%{http_code}' "$BASE_URL/api/$path"
  else
    curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" \
      -w '\n%{http_code}' "$BASE_URL/api/$path"
  fi
}

# split_status <combined-output> -> sets RESP_BODY and STATUS
split_status() {
  RESP_BODY="${1%$'\n'*}"
  STATUS="${1##*$'\n'}"
}

echo "== Smoke test: $BASE_URL =="

FRONT_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/")
check "index.html reachable" "$FRONT_STATUS" "200"

RESP=$(api GET session.php); split_status "$RESP"
check "session status before login" "$(jq -r '.authenticated' <<<"$RESP_BODY")" "false"

RESP=$(api POST login.php "$(jq -n --arg p "$SITE_PASSWORD" '{password:$p}')"); split_status "$RESP"
check "login request status" "$STATUS" "200"
check "login response ok" "$(jq -r '.ok // false' <<<"$RESP_BODY")" "true"

RESP=$(api GET session.php); split_status "$RESP"
check "session status after login" "$(jq -r '.authenticated' <<<"$RESP_BODY")" "true"

TITLE="Smoke Test Book $(date +%s)"
RESP=$(api POST books.php "$(jq -n --arg t "$TITLE" '{title:$t, author:"CI", startPage:5}')"); split_status "$RESP"
check "create book status" "$STATUS" "201"
BOOK_ID=$(jq -r '.book.id // empty' <<<"$RESP_BODY")
if [ -z "$BOOK_ID" ]; then
  echo "FAIL - create book returned no id; aborting further checks"
  fail=$((fail + 1))
  echo "== $pass passed, $fail failed =="
  exit 1
fi
echo "ok   - create book returned id ($BOOK_ID)"
pass=$((pass + 1))

RESP=$(api GET books.php); split_status "$RESP"
check "created book appears in list" \
  "$(jq -r --arg id "$BOOK_ID" '.books[] | select(.id==$id) | .title' <<<"$RESP_BODY")" \
  "$TITLE"

RESP=$(api POST entries.php "$(jq -n --arg id "$BOOK_ID" '{bookId:$id, page:42}')"); split_status "$RESP"
check "update page status" "$STATUS" "200"
check "updated page value" "$(jq -r '.book.currentPage' <<<"$RESP_BODY")" "42"

RESP=$(api DELETE "books.php?id=$BOOK_ID"); split_status "$RESP"
check "delete book status" "$STATUS" "200"

RESP=$(api GET books.php); split_status "$RESP"
check "book removed after delete" \
  "$(jq -r --arg id "$BOOK_ID" '[.books[] | select(.id==$id)] | length' <<<"$RESP_BODY")" \
  "0"

echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
