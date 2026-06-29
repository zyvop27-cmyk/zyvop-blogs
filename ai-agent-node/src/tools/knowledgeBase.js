import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const faqPath = path.join(__dirname, "..", "data", "faq.json");
const faqs = JSON.parse(readFileSync(faqPath, "utf-8"));

function score(faq, queryWords) {
  const text = `${faq.question} ${faq.answer}`.toLowerCase();
  return queryWords.reduce((total, word) => (text.includes(word) ? total + 1 : total), 0);
}

export const knowledgeBaseTool = {
  definition: {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description:
        "Search the company FAQ for policy questions: returns, shipping times, cancellations, " +
        "payment methods, and international shipping. Use this before answering policy questions from memory.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What the customer is asking about, e.g. 'return policy' or 'shipping to Canada'"
          }
        },
        required: ["query"]
      }
    }
  },

  async handler({ query }) {
    const queryWords = query
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 2);

    const ranked = faqs
      .map((faq) => ({ faq, score: score(faq, queryWords) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (ranked.length === 0) {
      return "No matching FAQ entry found.";
    }

    return ranked
      .slice(0, 2)
      .map((entry) => `Q: ${entry.faq.question}\nA: ${entry.faq.answer}`)
      .join("\n\n");
  }
};
