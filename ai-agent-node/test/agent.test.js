import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/agent.js";

const silentLogger = { warn: () => {} };

function makeScriptedClient(responses) {
  let call = 0;
  return {
    chat: {
      completions: {
        async create() {
          if (call >= responses.length) {
            throw new Error("Mock client ran out of scripted responses");
          }
          const next = responses[call];
          call += 1;
          if (next.throw) throw next.throw;
          return next;
        }
      }
    }
  };
}

const calculatorStub = {
  definition: {
    type: "function",
    function: {
      name: "calculate",
      description: "test calculator",
      parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] }
    }
  },
  async handler({ expression }) {
    if (expression === "boom") throw new Error("boom");
    return "4";
  }
};

test("runs a single tool call then returns the final answer", async () => {
  const client = makeScriptedClient([
    {
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "calculate", arguments: '{"expression":"2+2"}' } }
            ]
          }
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    },
    {
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "The answer is 4." } }],
      usage: { prompt_tokens: 15, completion_tokens: 8 }
    }
  ]);

  const agent = new Agent({
    client,
    model: "openai/gpt-oss-120b",
    tools: [calculatorStub],
    systemPrompt: "test",
    logger: silentLogger
  });

  const result = await agent.run("What is 2 + 2?");

  assert.equal(result.text, "The answer is 4.");
  assert.equal(result.steps, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.usage.inputTokens, 25);
  assert.equal(result.usage.outputTokens, 13);

  const toolCallStep = result.trace.find((step) => step.type === "tool_call");
  assert.equal(toolCallStep.tool, "calculate");
  assert.equal(toolCallStep.result, "4");
  assert.equal(toolCallStep.isError, false);
});

test("stops at the iteration cap instead of looping forever", async () => {
  const infiniteToolUse = {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_x", type: "function", function: { name: "calculate", arguments: '{"expression":"1+1"}' } }
          ]
        }
      }
    ],
    usage: { prompt_tokens: 5, completion_tokens: 5 }
  };
  // Model keeps calling tools forever; client has plenty of scripted repeats.
  const client = makeScriptedClient(Array(10).fill(infiniteToolUse));

  const agent = new Agent({
    client,
    model: "openai/gpt-oss-120b",
    tools: [calculatorStub],
    systemPrompt: "test",
    maxIterations: 3,
    logger: silentLogger
  });

  const result = await agent.run("Loop forever");

  assert.equal(result.truncated, true);
  assert.equal(result.steps, 3);
  assert.match(result.text, /step limit/);
});

test("feeds tool errors back to the model instead of crashing", async () => {
  const client = makeScriptedClient([
    {
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_2", type: "function", function: { name: "calculate", arguments: '{"expression":"boom"}' } }
            ]
          }
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    },
    {
      choices: [
        { finish_reason: "stop", message: { role: "assistant", content: "I couldn't complete that calculation." } }
      ],
      usage: { prompt_tokens: 12, completion_tokens: 6 }
    }
  ]);

  const agent = new Agent({
    client,
    model: "openai/gpt-oss-120b",
    tools: [calculatorStub],
    systemPrompt: "test",
    logger: silentLogger
  });

  const result = await agent.run("Trigger a tool failure");

  const toolCallStep = result.trace.find((step) => step.type === "tool_call");
  assert.equal(toolCallStep.isError, true);
  assert.match(toolCallStep.result, /Tool error: boom/);
  assert.equal(result.text, "I couldn't complete that calculation.");
});

test("handles malformed tool-call arguments from the model without crashing", async () => {
  const client = makeScriptedClient([
    {
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_3", type: "function", function: { name: "calculate", arguments: "{not json" } }]
          }
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    },
    {
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Sorry, something went wrong." } }],
      usage: { prompt_tokens: 12, completion_tokens: 6 }
    }
  ]);

  const agent = new Agent({
    client,
    model: "openai/gpt-oss-120b",
    tools: [calculatorStub],
    systemPrompt: "test",
    logger: silentLogger
  });

  const result = await agent.run("Send a malformed tool call");

  const toolCallStep = result.trace.find((step) => step.type === "tool_call");
  assert.equal(toolCallStep.isError, true);
  assert.match(toolCallStep.result, /invalid JSON arguments/);
});

test("retries a transient API error and then succeeds", async () => {
  const rateLimitError = Object.assign(new Error("Rate limited"), { status: 429 });
  const client = makeScriptedClient([
    { throw: rateLimitError },
    {
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Done after retry." } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }
  ]);

  const agent = new Agent({
    client,
    model: "openai/gpt-oss-120b",
    tools: [calculatorStub],
    systemPrompt: "test",
    logger: silentLogger
  });

  const result = await agent.run("Will this retry?");
  assert.equal(result.text, "Done after retry.");
});

test("does not retry a non-retryable API error", async () => {
  const authError = Object.assign(new Error("Invalid API key"), { status: 401 });
  const client = makeScriptedClient([{ throw: authError }]);

  const agent = new Agent({
    client,
    model: "openai/gpt-oss-120b",
    tools: [calculatorStub],
    systemPrompt: "test",
    logger: silentLogger
  });

  await assert.rejects(() => agent.run("This should fail immediately"), /Invalid API key/);
});
