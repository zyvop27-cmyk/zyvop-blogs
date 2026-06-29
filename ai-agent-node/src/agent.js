// Retryable HTTP statuses for the Groq API call itself (transient — retry with
// backoff). A 4xx like 401/400 means something about the request is wrong and
// retrying won't help.
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Agent {
  /**
   * @param {object} options
   * @param {object} options.client - A groq-sdk Groq instance (or a compatible mock for tests)
   * @param {string} options.model - Model string, e.g. "openai/gpt-oss-120b"
   * @param {Array<{definition: object, handler: Function}>} options.tools
   * @param {string} options.systemPrompt
   * @param {number} [options.maxIterations] - Hard cap on model round-trips per run()
   * @param {number} [options.maxTokens] - Maps to Groq's max_completion_tokens
   * @param {number} [options.toolTimeoutMs] - Per-tool-call timeout
   * @param {object} [options.logger] - Defaults to console; pass a no-op logger in tests to keep output quiet
   */
  constructor({
    client,
    model,
    tools,
    systemPrompt,
    maxIterations = 8,
    maxTokens = 1024,
    toolTimeoutMs = 10_000,
    logger = console
  }) {
    if (!client) throw new Error("Agent requires a client");
    if (!model) throw new Error("Agent requires a model");

    this.client = client;
    this.model = model;
    this.tools = tools;
    this.systemPrompt = systemPrompt;
    this.maxIterations = maxIterations;
    this.maxTokens = maxTokens;
    this.toolTimeoutMs = toolTimeoutMs;
    this.logger = logger;
  }

  toolDefinitions() {
    return this.tools.map((tool) => tool.definition);
  }

  findHandler(name) {
    const tool = this.tools.find((tool) => tool.definition.function.name === name);
    return tool ? tool.handler : null;
  }

  /**
   * Runs the agent loop for a single user message.
   * @param {string} userMessage
   * @param {object} [options]
   * @param {Array<object>} [options.history] - Prior message history to continue a conversation.
   *   Does NOT include the system message — that's injected fresh on every call.
   * @param {(step: object) => void} [options.onStep] - Called after every model call and every tool call
   */
  async run(userMessage, { history = [], onStep } = {}) {
    const messages = [...history, { role: "user", content: userMessage }];
    const trace = [];
    const usage = { inputTokens: 0, outputTokens: 0 };

    for (let step = 0; step < this.maxIterations; step++) {
      const response = await this.callModel(messages);
      usage.inputTokens += response.usage?.prompt_tokens ?? 0;
      usage.outputTokens += response.usage?.completion_tokens ?? 0;

      const choice = response.choices[0];
      const message = choice.message;

      if (choice.finish_reason !== "tool_calls" || !message.tool_calls?.length) {
        const text = (message.content ?? "").trim();
        messages.push({ role: "assistant", content: message.content ?? "" });
        const finalStep = { step, type: "final", text };
        trace.push(finalStep);
        onStep?.(finalStep);
        return { text, steps: step + 1, usage, trace, history: messages, truncated: false };
      }

      // Groq requires the assistant's tool_calls message echoed back verbatim
      // before the matching tool results — this is the OpenAI-style contract.
      messages.push({ role: "assistant", content: message.content, tool_calls: message.tool_calls });

      for (const toolCall of message.tool_calls) {
        const result = await this.executeTool(toolCall, step);
        trace.push(result.traceEntry);
        onStep?.(result.traceEntry);
        messages.push(result.toolMessage);
      }
    }

    const truncatedStep = { step: this.maxIterations, type: "max_iterations_reached" };
    trace.push(truncatedStep);
    onStep?.(truncatedStep);

    return {
      text: "I wasn't able to finish this within the step limit. Here's what I found before stopping.",
      steps: this.maxIterations,
      usage,
      trace,
      history: messages,
      truncated: true
    };
  }

  async executeTool(toolCall, step) {
    const name = toolCall.function.name;
    const handler = this.findHandler(name);
    const startedAt = Date.now();
    let content;
    let isError = false;

    try {
      if (!handler) throw new Error(`Unknown tool: ${name}`);

      let input;
      try {
        input = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        throw new Error(`Model sent invalid JSON arguments for "${name}"`);
      }

      content = await this.withTimeout(handler(input), this.toolTimeoutMs);
    } catch (err) {
      isError = true;
      content = `Tool error: ${err.message}`;
      this.logger.warn?.(`[agent] tool "${name}" failed: ${err.message}`);
    }

    const durationMs = Date.now() - startedAt;

    return {
      traceEntry: {
        step,
        type: "tool_call",
        tool: name,
        input: toolCall.function.arguments,
        result: content,
        isError,
        durationMs
      },
      // Groq/OpenAI-style tool result: a "tool" role message keyed by tool_call_id.
      // There's no separate is_error flag in this format — a failed tool just
      // returns its error as text, and the model reads it like any other result.
      toolMessage: {
        role: "tool",
        tool_call_id: toolCall.id,
        content: String(content)
      }
    };
  }

  async withTimeout(promise, ms) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async callModel(messages, attempt = 0) {
    const maxRetries = 3;
    try {
      return await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: this.maxTokens,
        messages: [{ role: "system", content: this.systemPrompt }, ...messages],
        tools: this.toolDefinitions(),
        tool_choice: "auto"
      });
    } catch (err) {
      const status = err?.status;
      const retryable = RETRYABLE_STATUS.has(status);

      if (!retryable || attempt >= maxRetries - 1) {
        throw err;
      }

      const delayMs = 500 * 2 ** attempt;
      this.logger.warn?.(`[agent] API call failed (status ${status}), retrying in ${delayMs}ms`);
      await sleep(delayMs);
      return this.callModel(messages, attempt + 1);
    }
  }
}
