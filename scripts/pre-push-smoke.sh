#!/usr/bin/env bash
# Simulación pre-push: build + smoke tests de API críticas.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${ROOT}/backend"
FRONTEND="${ROOT}/frontend"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:3000}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

pass() { echo -e "${GREEN}✓ PASS${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}✗ FAIL${NC} $1"; [ -n "${2:-}" ] && echo "       $2"; FAIL=$((FAIL + 1)); }
skip() { echo -e "${YELLOW}○ SKIP${NC} $1"; SKIP=$((SKIP + 1)); }

section() { echo; echo "━━━ $1 ━━━"; }

section "1. Backend — imports y sintaxis"
if (cd "$BACKEND" && python3 -m compileall -q src main.py 2>/dev/null); then
  pass "Python compileall (src + main.py)"
else
  fail "Python compileall" "Revisá errores de sintaxis en backend/"
fi

if (cd "$BACKEND" && python3 <<'PY'
from src.env_public import manychat_webhook_token, public_site_url
from src.controllers import conexiones_controller, webhook_controller
assert manychat_webhook_token(), "MANYCHAT_WEBHOOK_TOKEN vacío"
assert public_site_url().startswith("http"), "PUBLIC_SITE_URL inválida"
print("ok")
PY
); then
  pass "Imports críticos (env_public, conexiones, webhooks)"
else
  fail "Imports críticos" "Faltan deps o .env (MANYCHAT_WEBHOOK_TOKEN)"
fi

section "2. Frontend — build producción"
if (cd "$FRONTEND" && npm run build >/tmp/atvmkt-build.log 2>&1); then
  pass "npm run build"
else
  fail "npm run build" "Ver /tmp/atvmkt-build.log"
  tail -20 /tmp/atvmkt-build.log 2>/dev/null | sed 's/^/       /'
fi

section "3. Backend vivo — $BACKEND_URL"
if curl -sf --max-time 5 "${BACKEND_URL}/webhooks/manychat" >/tmp/mc-get.json 2>/dev/null; then
  pass "GET /webhooks/manychat (verify)"
else
  fail "GET /webhooks/manychat" "¿Está corriendo uvicorn en :8000?"
fi

TOKEN=""
TOKEN=$(cd "$BACKEND" && python3 <<'PY' 2>/dev/null || true
import os, sys
os.chdir(".")
from datetime import datetime, timedelta, timezone
from decouple import config
from jose import jwt
from pony.orm import db_session
from src.db import init_db
from src.models import AuthUser

init_db()
# Debe coincidir con auth_controller.py (NO usa SECRET del .env)
secret = config("JWT_SECRET", default="change-this-secret")
with db_session:
    user = AuthUser.select().first()
    if not user:
        sys.exit(1)
    username = user.username
exp = datetime.now(timezone.utc) + timedelta(hours=1)
print(jwt.encode({"sub": username, "exp": exp}, secret, algorithm="HS256"))
PY
)

if [ -n "$TOKEN" ]; then
  pass "JWT de prueba generado (primer AuthUser)"
else
  skip "JWT de prueba (sin usuarios en DB)"
fi

USER_ID=$(cd "$BACKEND" && python3 <<'PY' 2>/dev/null || true
from pony.orm import db_session
from src.db import init_db
from src.models import AuthUser
init_db()
with db_session:
    u = AuthUser.select().first()
    print(u.id if u else "")
PY
)

auth_hdr=()
user_hdr=()
if [ -n "$TOKEN" ]; then
  auth_hdr=(-H "Authorization: Bearer $TOKEN")
fi
if [ -n "$USER_ID" ]; then
  user_hdr=(-H "X-User-Id: $USER_ID")
fi

if [ ${#auth_hdr[@]} -gt 0 ]; then
  code=$(curl -s -o /tmp/conexiones.json -w "%{http_code}" --max-time 10 \
    "${auth_hdr[@]}" "${BACKEND_URL}/conexiones")
  if [ "$code" = "200" ] && python3 -c "import json; json.load(open('/tmp/conexiones.json'))" 2>/dev/null; then
    pass "GET /conexiones → 200 JSON array"
  else
    fail "GET /conexiones" "HTTP $code"
  fi

  code=$(curl -s -o /tmp/mc-info.json -w "%{http_code}" --max-time 10 \
    "${auth_hdr[@]}" "${BACKEND_URL}/conexiones/manychat-webhook-info")
  if [ "$code" = "200" ]; then
    url=$(python3 -c "import json; d=json.load(open('/tmp/mc-info.json')); print(d.get('webhook_url',''))" 2>/dev/null)
    tok=$(python3 -c "import json; d=json.load(open('/tmp/mc-info.json')); print(len(d.get('webhook_token','')))" 2>/dev/null)
    if echo "$url" | grep -q '/api/webhooks/manychat' && [ "${tok:-0}" -gt 10 ]; then
      pass "GET /conexiones/manychat-webhook-info → URL + token OK"
    else
      fail "manychat-webhook-info payload" "url=$url token_len=$tok"
    fi
  else
    fail "GET /conexiones/manychat-webhook-info" "HTTP $code — $(cat /tmp/mc-info.json 2>/dev/null | head -c 200)"
  fi

  code=$(curl -s -o /tmp/cal-info.json -w "%{http_code}" --max-time 10 \
    "${auth_hdr[@]}" "${BACKEND_URL}/conexiones/calendly-webhook-info")
  if [ "$code" = "200" ] && grep -q '/api/webhooks/calendly' /tmp/cal-info.json 2>/dev/null; then
    pass "GET /conexiones/calendly-webhook-info → 200"
  else
    fail "GET /conexiones/calendly-webhook-info" "HTTP $code"
  fi

  for path in /api/avatars /api/call-reports /calendly/auto-sync-status; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
      "${auth_hdr[@]}" "${user_hdr[@]}" "${BACKEND_URL}${path}")
    if [ "$code" = "200" ]; then
      pass "GET ${path} → 200"
    else
      fail "GET ${path}" "HTTP $code"
    fi
  done
else
  skip "Endpoints autenticados (sin JWT)"
fi

section "4. Conexiones — catálogo sin Fathom"
if ! grep -q "key: 'fathom'" "$FRONTEND/src/features/conexiones/connection-platforms.ts" 2>/dev/null; then
  pass "Fathom no está en connection-platforms.ts"
else
  fail "Fathom sigue en connection-platforms.ts"
fi

if grep -q "glass-card" "$FRONTEND/src/features/conexiones/connection-card.tsx" 2>/dev/null; then
  pass "connection-card usa glass-card (estilo ATV)"
else
  fail "connection-card sin glass-card"
fi

section "5. Webhook ManyChat — token válido / inválido"
MC_TOKEN=$(cd "$BACKEND" && python3 -c "from src.env_public import manychat_webhook_token; print(manychat_webhook_token())" 2>/dev/null || echo "")

if [ -n "$MC_TOKEN" ]; then
  code=$(curl -s -o /tmp/mc-bad.json -w "%{http_code}" --max-time 10 -X POST \
    "${BACKEND_URL}/webhooks/manychat" \
    -H "Content-Type: application/json" \
    -d '{"event":"test","webhook_token":"wrong","keyword":"test"}')
  if [ "$code" = "401" ]; then
    pass "POST /webhooks/manychat token inválido → 401"
  else
    fail "POST /webhooks/manychat token inválido" "HTTP $code (esperado 401)"
  fi

  code=$(curl -s -o /tmp/mc-ok.json -w "%{http_code}" --max-time 10 -X POST \
    "${BACKEND_URL}/webhooks/manychat" \
    -H "Content-Type: application/json" \
    -d "{\"event\":\"respondio_auto\",\"webhook_token\":\"${MC_TOKEN}\",\"keyword\":\"respondio_auto\",\"contact_ig_username\":\"@smoke_test_user\"}")
  if [ "$code" = "200" ]; then
    pass "POST /webhooks/manychat token válido → 200"
  else
    fail "POST /webhooks/manychat token válido" "HTTP $code — $(cat /tmp/mc-ok.json 2>/dev/null | head -c 150)"
  fi
else
  skip "Webhook ManyChat (sin MANYCHAT_WEBHOOK_TOKEN)"
fi

section "6. Frontend vivo — proxy ManyChat ($FRONTEND_URL)"
if curl -sf --max-time 5 "${FRONTEND_URL}/api/webhooks/manychat" >/tmp/fe-mc-get.json 2>/dev/null; then
  pass "GET /api/webhooks/manychat (Next proxy → backend)"
else
  skip "GET /api/webhooks/manychat" "¿npm run dev en :3000?"
fi

if [ -n "$MC_TOKEN" ] && curl -sf --max-time 5 "${FRONTEND_URL}/api/webhooks/manychat" >/dev/null 2>&1; then
  code=$(curl -s -o /tmp/fe-mc-post.json -w "%{http_code}" --max-time 10 -X POST \
    "${FRONTEND_URL}/api/webhooks/manychat" \
    -H "Content-Type: application/json" \
    -d "{\"event\":\"respondio_auto\",\"webhook_token\":\"${MC_TOKEN}\",\"keyword\":\"respondio_auto\",\"contact_ig_username\":\"@smoke_proxy\"}")
  if [ "$code" = "200" ]; then
    pass "POST /api/webhooks/manychat via Next → 200"
  else
    fail "POST /api/webhooks/manychat via Next" "HTTP $code"
  fi
fi

section "7. Config deploy — JWT"
jwt_env=$(cd "$BACKEND" && python3 -c "from decouple import config; print(config('JWT_SECRET', default=''))" 2>/dev/null)
secret_env=$(cd "$BACKEND" && python3 -c "from decouple import config; print(config('SECRET', default=''))" 2>/dev/null)
if [ -n "$jwt_env" ]; then
  pass "JWT_SECRET definido en .env"
elif [ -n "$secret_env" ] && [ "$secret_env" != "atvmkt" ]; then
  skip "Solo SECRET en .env — auth usa JWT_SECRET (default change-this-secret). En VPS: JWT_SECRET=$secret_env"
else
  skip "JWT_SECRET no definido — auth usa default inseguro (change-this-secret)"
fi

if [ -n "$(cd "$BACKEND" && python3 -c "from src.env_public import manychat_webhook_token; print(manychat_webhook_token())" 2>/dev/null)" ]; then
  pass "MANYCHAT_WEBHOOK_TOKEN configurado"
else
  fail "MANYCHAT_WEBHOOK_TOKEN vacío" "Requerido para Conexiones ManyChat en VPS"
fi

section "8. Git — archivos sensibles"
if git -C "$ROOT" diff --cached --name-only 2>/dev/null | grep -q '\.env$'; then
  fail "backend/.env en staging" "NO pushees .env con secrets"
elif git -C "$ROOT" status --short | grep -q '^[^?].*backend/\.env'; then
  skip "backend/.env modificado localmente (no commitear)"
else
  pass "backend/.env no parece ir al commit"
fi

if git -C "$ROOT" diff --name-only HEAD 2>/dev/null | grep -q 'backend/\.env$'; then
  skip "backend/.env tiene cambios locales (ok para VPS, no commitear)"
fi

section "RESUMEN"
echo -e "  ${GREEN}${PASS} passed${NC}  ${RED}${FAIL} failed${NC}  ${YELLOW}${SKIP} skipped${NC}"
echo

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}No recomiendo pushear hasta corregir los FAIL.${NC}"
  exit 1
fi
echo -e "${GREEN}Simulación OK — riesgo bajo para push/deploy.${NC}"
exit 0
