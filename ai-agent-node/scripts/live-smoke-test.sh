#!/usr/bin/env bash
# Live smoke test for the agent API.
#
# Start the server first: npm start
# Then in another terminal:  bash scripts/live-smoke-test.sh
#
# Most of this needs a real GROQ_API_KEY in .env to get meaningful replies.
# The validation and rate-limit checks at the end work even with a placeholder
# key, since they fail before the agent ever calls Groq.
#
# Tip: every call this script makes counts against the same per-IP rate limit
# (default 10/minute). If you re-run it right after a previous run, you'll
# hit 429s almost immediately — that's the limit window still cooling down,
# not a bug. Wait a minute between runs for a clean read.

set -uo pipefail
BASE_URL="${1:-http://localhost:3000}"
SESSION_ID="smoke-test-$$"

post() {
  curl -s -X POST "$BASE_URL/api/agent/chat" \
    -H "Content-Type: application/json" \
    -d "$1"
  echo
}

echo "=== health check ==="
curl -s "$BASE_URL/healthz"
echo
echo

echo "=== 1. order lookup, happy path (should call get_order_status) ==="
post "{\"message\": \"What is the status of ORD-1001?\", \"sessionId\": \"$SESSION_ID\"}"
echo

echo "=== 2. unknown order (tool throws 'no order found' — should fail gracefully, not crash) ==="
post "{\"message\": \"What about ORD-9999?\", \"sessionId\": \"$SESSION_ID\"}"
echo

echo "=== 3. simulated outage (exercises the tool-error path end to end) ==="
post "{\"message\": \"Can you check ORD-FAIL for me?\", \"sessionId\": \"$SESSION_ID\"}"
echo

echo "=== 4. calculator ==="
post "{\"message\": \"What is 199.99 minus 15 percent?\", \"sessionId\": \"$SESSION_ID\"}"
echo

echo "=== 5. knowledge base ==="
post "{\"message\": \"What is your return policy?\", \"sessionId\": \"$SESSION_ID\"}"
echo

echo "=== 6. multi-tool in a single turn (order lookup + a calculation) ==="
post "{\"message\": \"What is the status of ORD-1001, and if I return it how much of the \$89.99 do I get back after a 15% restocking fee?\", \"sessionId\": \"$SESSION_ID\"}"
echo

echo "=== 7. session continuity (should remember ORD-1001 from step 1 without re-stating it) ==="
post "{\"message\": \"And what carrier is it with?\", \"sessionId\": \"$SESSION_ID\"}"
echo

echo "=== 8. validation: empty message should 400, not reach the agent ==="
curl -s -o /dev/null -w "status=%{http_code}\n" -X POST "$BASE_URL/api/agent/chat" \
  -H "Content-Type: application/json" -d '{"message":""}'
echo

echo "=== 9. local rate limit: firing 12 more requests ==="
echo "    (works even with a placeholder key — the limiter runs before the agent call)"
echo "    Note: steps 1-8 above already counted against this same per-IP limit"
echo "    (default: 10/minute), so 429s will likely show up well before request 12 —"
echo "    that's correct. The limit is cumulative across the whole script, not per section."
for i in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/agent/chat" \
    -H "Content-Type: application/json" -d '{"message":"hi","sessionId":"rate-limit-test"}')
  echo "    request $i -> $code"
done

echo
echo "Done. Re-run with the server's console open to see retry/error logs as they happen."
