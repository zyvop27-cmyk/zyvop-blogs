import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import { rateLimit } from "express-rate-limit";
import Groq from "groq-sdk";
import { Agent } from "./agent.js";
import { tools } from "./tools/index.js";

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

if (!process.env.GROQ_API_KEY) {
  console.error("Missing GROQ_API_KEY. Copy .env.example to .env and add your key from console.groq.com/keys.");
  process.exit(1);
}

// maxRetries: 0 because the Agent class already retries transient failures
// itself (with logging and a visible backoff). Leaving the SDK's own default
// retry on top would retry the same failure twice, invisibly.
const client = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 });

const SYSTEM_PROMPT = `You are a customer support agent for an online store.
Use the available tools to look up real order data, search the FAQ, and do math.
Never guess at order status or policy details — look them up.
Keep answers short and to the point.`;

const agent = new Agent({
  client,
  model: MODEL,
  tools,
  systemPrompt: SYSTEM_PROMPT,
  maxIterations: 8
});

// In-memory session store, keyed by sessionId, holding each conversation's
// message history. Swap this for Redis or a database in real production —
// it disappears on restart and won't work across multiple server instances.
const sessions = new Map();

const app = express();
app.use(express.json());

// Groq's free tier caps out around 30 requests/minute per model at the time
// of writing — this limit sits comfortably under that so a few concurrent
// users don't burn through the account-wide quota on their own.
const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment and try again." }
});

app.post("/api/agent/chat", chatLimiter, async (req, res) => {
  const { message, sessionId } = req.body ?? {};

  if (typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ error: "Request body must include a non-empty 'message' string." });
  }

  const activeSessionId = sessionId || crypto.randomUUID();
  const history = sessions.get(activeSessionId) ?? [];

  try {
    const result = await agent.run(message, { history });
    sessions.set(activeSessionId, result.history);

    res.json({
      sessionId: activeSessionId,
      reply: result.text,
      steps: result.steps,
      truncated: result.truncated,
      usage: result.usage
    });
  } catch (err) {
    console.error("[agent] run failed:", err);
    res.status(502).json({ error: "The agent failed to complete this request. Please try again." });
  }
});

app.post("/api/agent/reset", (req, res) => {
  const { sessionId } = req.body ?? {};
  if (sessionId) sessions.delete(sessionId);
  res.json({ ok: true });
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Agent API listening on http://localhost:${PORT}`);
});
