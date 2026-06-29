# AI Agent in Node.js — Production-Style Demo (Groq)

A tool-calling agent built directly on Groq's API (OpenAI-compatible, running open-source models on their LPU hardware), with no agent framework in between. It implements the loop by hand: reason, call a tool, observe the result, repeat — with the parts most tutorials skip: iteration caps, retries, per-tool timeouts, and tool errors that get fed back to the model instead of crashing the process.

## A note on "free"

Groq's free tier needs no credit card, but it's rate-limited, not unlimited — roughly 30 requests/minute and a daily request cap per model, enforced at the account level (multiple keys don't multiply it). That's plenty for this demo and for prototyping. It is not enough for real user traffic; check [Groq's current rate limits](https://console.groq.com/docs/rate-limits) before you plan around it.

## What it does

A customer-support agent for a fictional online store. It can:

- Look up order status (`get_order_status`)
- Do math for totals and discounts (`calculate`)
- Search a small FAQ (`search_knowledge_base`)

Try asking it: *"What's the status of ORD-1001, and if I return it how much
of the $89.99 do I get back after the 15% restocking fee?"* — that needs two
tools and a calculation in the same turn.

## Setup

```bash
npm install
cp .env.example .env
# get a key at console.groq.com/keys (no credit card needed) and add it to .env
```

## Run it

```bash
# Interactive terminal chat
npm run cli
npm run cli -- --verbose   # also prints every tool call

# HTTP API
npm start
```

```bash
curl -X POST http://localhost:3000/api/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the status of ORD-1001?"}'
```

```json
{
  "sessionId": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "reply": "Order ORD-1001 has shipped via UPS, tracking number 1Z999AA10123456784. It's estimated to arrive July 2, 2026.",
  "steps": 2,
  "truncated": false,
  "usage": { "inputTokens": 612, "outputTokens": 47 }
}
```

(The envelope above — `sessionId`, `reply`, `steps`, `truncated`, `usage` — is exactly what the server returns. The actual wording, token counts, and step count will vary by run since it's a live model, not a fixture.)

The response includes a `sessionId`. Pass it back on the next request to
continue the same conversation:

```bash
curl -X POST http://localhost:3000/api/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "And what carrier is it with?", "sessionId": "a1b2c3d4-5678-90ab-cdef-1234567890ab"}'
```

```json
{
  "sessionId": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "reply": "It's shipping with UPS.",
  "steps": 1,
  "truncated": false,
  "usage": { "inputTokens": 58, "outputTokens": 9 }
}
```

Note `steps: 1` this time — no tool call needed, since the carrier was already
in the conversation history from the first answer.

## Testing it for real

`npm test` proves the loop logic against a mock. It doesn't prove the model
actually picks the right tool, or that your key and rate limits work. For that:

```bash
npm start                                  # in one terminal
bash scripts/live-smoke-test.sh            # in another
```

The script exercises, in order: a normal order lookup, an unknown order ID,
the simulated outage on `ORD-FAIL`, the calculator, the FAQ search, a single
turn that needs two tools at once, session continuity across two messages,
input validation, and the local rate limiter (10 requests/minute by default).
Steps 1–7 need a real `GROQ_API_KEY` to return anything meaningful; the
validation and rate-limit checks work even with a placeholder key, since they
fail before the agent ever calls Groq.

Re-running it right after a previous run will hit 429s almost immediately —
that's the per-minute window still cooling down, not a bug. Wait a minute
between runs, or pass a different port to a fresh server instance.

If you'd rather poke at it by hand, `npm run cli -- --verbose` gives you the
same tool calls printed live as they happen, which is the fastest way to see
*why* the model picked a given tool, not just whether it did.

## Tests

```bash
npm test
```

The agent loop is tested with a scripted mock client (no API key needed), so
you can verify tool calling, iteration caps, error handling, and retry logic
without spending a single request against your rate limit. That's the full
extent of what's verified here — there's no live call against Groq's actual
API in this repo's test suite, so run the CLI or server with a real
`GROQ_API_KEY` yourself before trusting it further.

## Project layout

```
src/
  agent.js            the ReAct loop: retries, timeouts, iteration cap, tracing
  server.js           Express API, rate-limited, with in-memory sessions
  cli.js              interactive terminal chat
  tools/
    calculator.js     safe arithmetic (no eval)
    orders.js         mock order lookup, with a simulated outage for testing
    knowledgeBase.js   keyword search over a small FAQ
  data/                the mock "database" backing the tools above
test/
  agent.test.js        loop behavior against a scripted mock client
  safeCalculate.test.js
  tools.test.js
scripts/
  live-smoke-test.sh   exercises every tool path against a running server
```

## Taking this to real production

This is a teaching example, not a finished product. Before you ship something
like it:

- Swap the in-memory session `Map` for Redis or a database — it disappears on
  restart and won't work across multiple server instances.
- Swap the mock data files for real database/API calls.
- Add structured logging (the trace objects in `agent.js` are already shaped
  for this — pipe them to your logger of choice).
- Track token usage per request against a budget, not just for visibility.
- Add auth in front of `/api/agent/chat` — right now anyone who can reach the
  port can spend your API budget.
- Consider trimming or summarizing long-running conversation history before
  it eats your context window.
- Watch for 429s under real load — the free tier's per-minute cap is easy to
  hit with more than a couple of concurrent users. Groq's Developer tier
  (still no minimum spend) raises that ceiling.

## License

MIT
