#!/usr/bin/env bash
# Linkfit admin panel — ops endpoints smoke test (admin-4 / admin-5).
#
# Companion to scripts/smoke.sh. Hits the newly-wired admin endpoints that the
# six new ops pages and the full-inventory venue picker depend on, so a broken
# route is caught before it reaches the UI. Sends X-Linkfit-App-Key (admin-1)
# on every call so it works against the gated prod API too.
#
# Usage:
#   ./scripts/smoke-ops.sh
#   API_URL=https://api.linkfit.az LINKFIT_APP_KEY=lk_xxx \
#     ADMIN_EMAIL=admin@linkfit.az ADMIN_PASSWORD='...' ./scripts/smoke-ops.sh
#
# Exit codes: 0 = all green, 1 = at least one endpoint failed, 2 = login failed.

set -u
set -o pipefail

API_URL="${API_URL:-http://localhost:3000}"
API_PREFIX="${API_PREFIX:-/api/v1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@linkfit.app}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-AdminPass123!}"
# Public web key for the Cloudflare/Laravel ApiKeyGuard. Accept either name.
LINKFIT_APP_KEY="${LINKFIT_APP_KEY:-${NEXT_PUBLIC_LINKFIT_APP_KEY:-}}"

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[0;33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
CHECK="${GREEN}\xE2\x9C\x93${RESET}"; CROSS="${RED}\xE2\x9C\x97${RESET}"

PASS_COUNT=0; FAIL_COUNT=0; FAIL_LIST=()

warn() { printf "%s%s%s\n" "${YELLOW}" "$*" "${RESET}"; }
info() { printf "%s%s%s\n" "${DIM}" "$*" "${RESET}"; }

command -v curl >/dev/null 2>&1 || { printf "%sMissing curl%s\n" "${RED}" "${RESET}" >&2; exit 2; }

# Build the shared header args (app key is optional for local non-gated runs).
APPKEY_ARGS=()
if [ -n "${LINKFIT_APP_KEY}" ]; then
  APPKEY_ARGS=(-H "X-Linkfit-App-Key: ${LINKFIT_APP_KEY}")
fi

info "API:  ${API_URL}${API_PREFIX}"
info "User: ${ADMIN_EMAIL}"
[ -n "${LINKFIT_APP_KEY}" ] && info "App key: ${LINKFIT_APP_KEY:0:8}…" || warn "No X-Linkfit-App-Key set — fine for local, will 403 against the gated prod API."
echo

# ---------- login ----------
info "Logging in…"
LOGIN_RESPONSE="$(curl -sS \
  "${APPKEY_ARGS[@]}" \
  -X POST "${API_URL}${API_PREFIX}/auth/admin/login" \
  -H "Content-Type: application/json" \
  --data "$(printf '{"email":"%s","password":"%s"}' "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}")" \
  || true)"

ACCESS_TOKEN="$(printf '%s' "${LOGIN_RESPONSE}" \
  | sed -n 's/.*"access[_]\{0,1\}[Tt]oken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | head -n 1)"

if [ -z "${ACCESS_TOKEN}" ]; then
  printf "%b login failed — could not extract access token.\n" "${CROSS}"
  printf "%sresponse:%s %s\n" "${DIM}" "${RESET}" "${LOGIN_RESPONSE}"
  exit 2
fi
printf "%b login ok ${DIM}(token %s…)${RESET}\n\n" "${CHECK}" "${ACCESS_TOKEN:0:12}"

# ---------- hit each ops endpoint ----------
hit() {
  local label="$1" path="$2"
  local url="${API_URL}${API_PREFIX}${path}"
  local code
  code="$(curl -sS -o /tmp/linkfit_ops_body.$$ -w "%{http_code}" \
    "${APPKEY_ARGS[@]}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Accept: application/json" \
    "${url}" || true)"

  if [ "${code}" = "200" ] || [ "${code}" = "204" ]; then
    printf "%b %-22s %s${DIM} → %s${RESET}\n" "${CHECK}" "${label}" "${path}" "${code}"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf "%b %-22s %s${DIM} → %s${RESET}\n" "${CROSS}" "${label}" "${path}" "${code}"
    [ -s /tmp/linkfit_ops_body.$$ ] && { sed -e 's/^/      /' /tmp/linkfit_ops_body.$$ | head -c 300; echo; }
    FAIL_COUNT=$((FAIL_COUNT + 1)); FAIL_LIST+=("${label} (${path} → ${code})")
  fi
  rm -f /tmp/linkfit_ops_body.$$
}

# admin-5: admin venues endpoint (all statuses, vs the public /venues catalog).
hit "venues (admin)"        "/admin/venues?limit=5"
# admin-4: analytics.
hit "analytics overview"    "/admin/analytics/overview"
hit "revenue"               "/admin/revenue"
# admin-4: support.
hit "support tickets"       "/admin/support/tickets?limit=5"
# admin-4: moderation.
hit "owner applications"    "/admin/owner-applications?limit=5"
hit "reviews"               "/admin/reviews?limit=5"
# admin-4: promos.
hit "promo codes"           "/admin/promo-codes?limit=5"
# admin-4: staff.
hit "staff"                 "/admin/staff"
# admin-4: data rights.
hit "deletion requests"     "/admin/data-rights/deletions"
hit "export requests"       "/admin/data-rights/exports"

# ---------- summary ----------
echo
TOTAL=$((PASS_COUNT + FAIL_COUNT))
if [ "${FAIL_COUNT}" -eq 0 ]; then
  printf "%bAll %d ops endpoints passed.%s\n" "${GREEN}" "${TOTAL}" "${RESET}"
  exit 0
fi
printf "%b%d/%d failed:%s\n" "${RED}" "${FAIL_COUNT}" "${TOTAL}" "${RESET}"
for f in "${FAIL_LIST[@]}"; do printf "  - %s\n" "${f}"; done
exit 1
