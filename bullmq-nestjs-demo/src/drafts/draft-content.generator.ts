/**
 * Stands in for a real call to an LLM provider (Groq, OpenAI, etc). It
 * simulates realistic latency and an optional, deterministic number of
 * failures, so the retry/backoff behavior can be demonstrated on demand
 * instead of relying on an upstream provider actually being flaky.
 *
 * `attemptsMade` is 0 on the FIRST execution and increments from there —
 * that's how BullMQ reports it, not 1-indexed.
 */
export async function generateDraftContent(
  topic: string,
  attemptsMade: number,
  simulateFailures: number,
): Promise<string> {
  await sleep(800 + Math.random() * 400); // pretend this is the LLM round-trip

  if (attemptsMade < simulateFailures) {
    throw new Error(
      `Simulated upstream failure on attempt ${attemptsMade + 1} ` +
        `(configured to fail ${simulateFailures} time(s) before succeeding)`,
    );
  }

  return (
    `# ${topic}\n\n` +
    `Generated draft content for "${topic}" — succeeded on attempt ${attemptsMade + 1}.`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
