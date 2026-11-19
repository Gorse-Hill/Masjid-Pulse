#!/usr/bin/env bash
# Smoke-test the main journey against a running server:
# register -> create prayer times -> publish -> pair TV -> fetch snapshot.
# Usage: BASE=http://localhost:3000 bash scripts/smoke.sh   (requires curl + node)
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"
EMAIL="smoke-$(date +%s)-$RANDOM@example.com"
j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const e=process.argv[1];console.log(eval(/^[\\w.]+$/.test(e)?'o.'+e:e))})" "$1"; }
step() { echo; echo "== $*"; }

step "GET /api/health"
curl -fsS "$BASE/api/health"; echo

step "POST /api/auth/register"
REG=$(curl -fsS -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Tester\",\"email\":\"$EMAIL\",\"password\":\"password123\",\"mosqueName\":\"Smoke Test Masjid\",\"city\":\"Mogadishu\",\"timezone\":\"Africa/Mogadishu\"}")
echo "$REG" | head -c 300; echo
TOKEN=$(echo "$REG" | j token); MID=$(echo "$REG" | j mosque.id)
AUTH="Authorization: Bearer $TOKEN"

step "Publishing is blocked until the email is verified"
curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X POST "$BASE/api/mosques/$MID/publish" -H "$AUTH"

step "Verify email via the dev outbox (server started with DEV_OUTBOX=1, no SMTP)"
VTOKEN=$(curl -fsS "$BASE/api/dev/outbox" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s).filter(x=>x.to===process.argv[1]).pop();console.log(decodeURIComponent(/token=([^\s&]+)/.exec(m.text)[1]))})" "$EMAIL")
curl -fsS -X POST "$BASE/api/auth/verify-email" -H 'Content-Type: application/json' -d "{\"token\":\"$VTOKEN\"}"; echo
TODAY=$(curl -fsS "$BASE/api/mosques/$MID/prayers?days=1" -H "$AUTH" | j today)
echo "mosque id=$MID, mosque-local today=$TODAY"

step "PUT /api/mosques/$MID/prayers/$TODAY"
curl -fsS -X PUT "$BASE/api/mosques/$MID/prayers/$TODAY" -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "fajr":{"adhan":"04:50","iqamah":"05:10"},"dhuhr":{"adhan":"11:55","iqamah":"12:15"},
  "asr":{"adhan":"15:15","iqamah":"15:30"},"maghrib":{"adhan":"17:50","iqamah":"17:55"},
  "isha":{"adhan":"19:05","iqamah":"19:20"}}' | head -c 300; echo

step "PATCH quick iqamah (Isha, today only)"
curl -fsS -X PATCH "$BASE/api/mosques/$MID/prayers/$TODAY/iqamah" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"prayer":"isha","iqamah":"19:30","todayOnly":true}' | head -c 200; echo

step "POST announcement"
curl -fsS -X POST "$BASE/api/mosques/$MID/announcements" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"title\":\"Smoke test\",\"body\":\"Hello\",\"startDate\":\"$TODAY\",\"endDate\":\"$TODAY\"}"; echo

step "GET publish status (before)"
curl -fsS "$BASE/api/mosques/$MID/publish/status" -H "$AUTH"; echo

step "POST /publish"
curl -fsS -X POST "$BASE/api/mosques/$MID/publish" -H "$AUTH" | j "JSON.stringify({version:o.version,publishedAt:o.publishedAt,days:o.snapshot.days.length})"
PUB=$(curl -fsS "$BASE/api/mosques/$MID/publish/status" -H "$AUTH"); echo "status after publish: $PUB"

step "TV: POST /api/tv/pairing"
PAIR=$(curl -fsS -X POST "$BASE/api/tv/pairing"); echo "$PAIR"
CODE=$(echo "$PAIR" | j code); PID=$(echo "$PAIR" | j pairingId); SECRET=$(echo "$PAIR" | j pairingSecret)

step "TV polls status (pending)"
curl -fsS "$BASE/api/tv/pairing/$PID" -H "X-Pairing-Secret: $SECRET"; echo

step "Admin enters code $CODE"
curl -fsS -X POST "$BASE/api/mosques/$MID/devices/pair" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"code\":\"$CODE\",\"name\":\"Main Hall TV\"}"; echo

step "Admin re-enters same code (must fail: one-time use)"
curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X POST "$BASE/api/mosques/$MID/devices/pair" -H "$AUTH" -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}"

step "TV polls status (paired, receives token once)"
ST=$(curl -fsS "$BASE/api/tv/pairing/$PID" -H "X-Pairing-Secret: $SECRET")
DEVTOKEN=$(echo "$ST" | j deviceToken); echo "status=$(echo "$ST" | j status) token=${DEVTOKEN:0:6}…"

step "TV: GET /api/tv/snapshot"
SNAP=$(curl -fsS "$BASE/api/tv/snapshot" -H "Authorization: Device $DEVTOKEN")
echo "$SNAP" | j "JSON.stringify({version:o.snapshot.version,mosque:o.snapshot.mosque.name,today:o.snapshot.days[0],announcements:o.snapshot.announcements.length})"
VER=$(echo "$SNAP" | j snapshot.version)

step "TV: GET /api/tv/snapshot?version=$VER (unchanged)"
curl -fsS "$BASE/api/tv/snapshot?version=$VER" -H "Authorization: Device $DEVTOKEN"; echo

step "Admin: devices"
curl -fsS "$BASE/api/mosques/$MID/devices" -H "$AUTH"; echo

echo; echo "SMOKE OK"
