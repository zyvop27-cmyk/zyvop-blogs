import { safeCalculate } from "../lib/safeCalculate.js";

export const calculatorTool = {
  definition: {
    type: "function",
    function: {
      name: "calculate",
      description:
        "Evaluate a basic arithmetic expression. Supports +, -, *, /, ^, parentheses, and decimals. " +
        "Always use this instead of doing math yourself, including for things like order totals or discounts.",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "A math expression, e.g. '(42 + 8) * 3' or '199.99 * 0.85'"
          }
        },
        required: ["expression"]
      }
    }
  },

  async handler({ expression }) {
    const result = safeCalculate(expression);
    return String(result);
  }
};
