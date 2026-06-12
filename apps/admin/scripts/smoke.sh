#!/usr/bin/env bash
# Linkfit admin panel — end-to-end smoke test.
#
# Assumes the API is already running (defaults to http://localhost:3000).
# Walks the full happy path an admin would hit: register/login → call every
# /admin/* endpoint at least once → print a per-endpoint pass/fail summary.
#
# Usage:
#   ./scripts/smoke.sh
#   API_URL=http://localhost:3000 ADMIN_EMAIL=admin@linkfit.app ADMIN_PASSWORD='hunter2!' ./scripts/smoke.sh
#
# Exit codes: 0 = all green, 1 = at least one endpoint failed, 2 = login failed.

set -u
set -o pipefail

# ---------- config ----------
API_URL="${API_URL:-http://localhost:3000}"
API_PREFIX="${API_PREFIX:-/api/v1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@linkfit.app}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-AdminPass123!}"
ADMIN_DISPLAY_NAME="${ADMIN_DISPLAY_NAME:-Admin Smoke}"
REGISTER_IF_MISSING="${REGISTER_IF_MISSING:-1}"

GREEN=$'\033[0;32m'
RED=$'\033[0;31m'
YELLOW=$'\033[0;33m'
DIM=$'\033[2m'
RESET=$'\033[0m'

CHECK="${GREEN}\xE2\x9C\x93${RESET}"
CROSS="${RED}\xE2\x9C\x97${RESET}"

PASS_COUNT=0
FAIL_COUNT=0
FAIL_LIST=()

log()   { printf "%s\n" "$*"; }
info()  { printf "%s\n" "${DIM}$*${RESET}"; }
warn()  { printf "%s%s%s\n" "${YELLOW}" "$*" "${RESET}"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "%sMissing required command: %s%s\n" "${RED}" "$1" "${RESET}" >&2
    exit 2
  fi
}

require_cmd curl

# ---------- 1. probe API ----------
log "${DIM}API:${RESET}   ${API_URL}${API_PREFIX}"
log "${DIM}User:${RESET}  ${ADMIN_EMAIL}"
echo

if ! curl -fsS --max-time 5 "${API_URL}/health" >/dev/null 2>&1 \
   && ! curl -fsS --max-time 5 "${API_URL}${API_PREFIX}/health" >/dev/null 2>&1; then
  warn "API does not respond at ${API_URL} (tried /health and ${API_PREFIX}/health) — continuing anyway."
fi

# ---------- 2. register (best-effort) ----------
if [ "${REGISTER_IF_MISSING}" = "1" ]; then
  info "Registering admin user (ignored if already exists)..."
  curl -sS -o /dev/null -w "  register: HTTP %{http_code}\n" \
    -X POST "${API_URL}${API_PREFIX}/auth/register" \
    -H "Content-Type: application/json" \
    --data "$(printf '{"email":"%s","password":"%s","displayName":"%s"}' \
              "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}" "${ADMIN_DISPLAY_NAME}")" \
    || true
fi

# ---------- 3. login ----------
info "Logging in..."
LOGIN_RESPONSE="$(curl -sS \
  -X POST "${API_URL}${API_PREFIX}/auth/login" \
  -H "Content-Type: application/json" \
  --data "$(printf '{"email":"%s","password":"%s"}' "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}")" \
  || true)"

# Extract access token. Tolerates a few common shapes:
#   { "accessToken": "..." }
#   { "access_token": "..." }
#   { "tokens": { "accessToken": "..." } }
ACCESS_TOKEN="$(printf '%s' "${LOGIN_RESPONSE}" \
  | sed -n 's/.*"access[_]\{0,1\}[Tt]oken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | head -n 1)"

if [ -z "${ACCESS_TOKEN}" ]; then
  printf "%s login failed — could not extract access token.\n" "${CROSS}"
  printf "%sresponse:%s %s\n" "${DIM}" "${RESET}" "${LOGIN_RESPONSE}"
  exit 2
fi

printf "%b login ok ${DIM}(token %s…)${RESET}\n\n" "${CHECK}" "${ACCESS_TOKEN:0:12}"

# ---------- 4. hit each admin endpoint ----------
hit() {
  local label="$1"
  local path="$2"
  local url="${API_URL}${API_PREFIX}${path}"

  local code body
  body="$(curl -sS -o /tmp/linkfit_smoke_body.$$ -w "%{http_code}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Accept: application/json" \
    "${url}" || true)"
  code="${body}"

  if [ "${code}" = "200" ] || [ "${code}" = "204" ]; then
    printf "%b %-14s %s${DIM} → %s${RESET}\n" "${CHECK}" "${label}" "${path}" "${code}"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf "%b %-14s %s${DIM} → %s${RESET}\n" "${CROSS}" "${label}" "${path}" "${code}"
    if [ -s /tmp/linkfit_smoke_body.$$ ]; then
      sed -e 's/^/      /' /tmp/linkfit_smoke_body.$$ | head -c 400
      echo
    fi
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_LIST+=("${label} (${path} → ${code})")
  fi
  rm -f /tmp/linkfit_smoke_body.$$
}

hit "stats"        "/admin/stats"
hit "users"        "/admin/users"
hit "games"        "/admin/games"
hit "venues"       "/admin/venues"
hit "tournaments"  "/admin/tournaments"
hit "reports"      "/admin/reports"
hit "audit"        "/admin/audit"

# ---------- 5. summary ----------
echo
TOTAL=$((PASS_COUNT + FAIL_COUNT))
if [ "${FAIL_COUNT}" -eq 0 ]; then
  printf "%bAll %d admin endpoints passed.%s\n" "${GREEN}" "${TOTAL}" "${RESET}"
  exit 0
fi

printf "%b%d/%d failed:%s\n" "${RED}" "${FAIL_COUNT}" "${TOTAL}" "${RESET}"
for f in "${FAIL_LIST[@]}"; do
  printf "  - %s\n" "${f}"
done
exit 1
