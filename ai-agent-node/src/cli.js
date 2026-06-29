import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import Groq from "groq-sdk";
import { Agent } from "./agent.js";
import { tools } from "./tools/index.js";

if (!process.env.GROQ_API_KEY) {
  console.error("Missing GROQ_API_KEY. Copy .env.example to .env and add your key from console.groq.com/keys.");
  process.exit(1);
}

const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const VERBOSE = process.argv.includes("--verbose");

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

function logStep(step) {
  if (!VERBOSE) return;
  if (step.type === "tool_call") {
    const tag = step.isError ? "tool error" : "tool call";
    console.log(`  [${tag}] ${step.tool}(${step.input}) -> ${step.result} (${step.durationMs}ms)`);
  } else if (step.type === "max_iterations_reached") {
    console.log("  [stopped] hit the iteration cap");
  }
}

async function main() {
  console.log(`Connected. Model: ${MODEL}. Try: "What's the status of ORD-1001?" Ctrl+C to quit.`);
  if (VERBOSE) console.log("(verbose mode: showing tool calls)");

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let history = [];

  while (true) {
    const userMessage = await rl.question("\nyou> ");
    if (!userMessage.trim()) continue;

    const result = await agent.run(userMessage, { history, onStep: logStep });
    history = result.history;

    console.log(`\nagent> ${result.text}`);
    if (result.truncated) {
      console.log("(hit the iteration cap before finishing)");
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
