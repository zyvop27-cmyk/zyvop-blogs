import { test } from "node:test";
import assert from "node:assert/strict";
import { orderStatusTool } from "../src/tools/orders.js";
import { knowledgeBaseTool } from "../src/tools/knowledgeBase.js";

test("order status returns known order", async () => {
  const result = await orderStatusTool.handler({ orderId: "ORD-1001" });
  const parsed = JSON.parse(result);
  assert.equal(parsed.status, "shipped");
  assert.equal(parsed.carrier, "UPS");
});

test("order status throws for unknown order", async () => {
  await assert.rejects(
    () => orderStatusTool.handler({ orderId: "ORD-9999" }),
    /No order found/
  );
});

test("order status throws for simulated outage", async () => {
  await assert.rejects(
    () => orderStatusTool.handler({ orderId: "ORD-FAIL" }),
    /timed out/
  );
});

test("knowledge base finds a relevant FAQ", async () => {
  const result = await knowledgeBaseTool.handler({ query: "return policy" });
  assert.match(result, /30 days/);
});

test("knowledge base reports no match", async () => {
  const result = await knowledgeBaseTool.handler({ query: "xyzzy unrelated nonsense" });
  assert.equal(result, "No matching FAQ entry found.");
});
