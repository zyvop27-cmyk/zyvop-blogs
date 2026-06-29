import { test } from "node:test";
import assert from "node:assert/strict";
import { safeCalculate } from "../src/lib/safeCalculate.js";

test("evaluates basic addition", () => {
  assert.equal(safeCalculate("2 + 2"), 4);
});

test("respects operator precedence", () => {
  assert.equal(safeCalculate("2 + 3 * 4"), 14);
});

test("handles parentheses", () => {
  assert.equal(safeCalculate("(2 + 3) * 4"), 20);
});

test("handles decimals", () => {
  assert.equal(safeCalculate("199.99 * 0.85"), 169.9915);
});

test("handles exponents right-associatively", () => {
  assert.equal(safeCalculate("2 ^ 3 ^ 2"), 512); // 2 ^ (3 ^ 2)
});

test("handles unary minus", () => {
  assert.equal(safeCalculate("-5 + 10"), 5);
});

test("rejects division by zero", () => {
  assert.throws(() => safeCalculate("4 / 0"), /Division by zero/);
});

test("rejects non-arithmetic input", () => {
  assert.throws(() => safeCalculate("process.exit(1)"));
});

test("rejects empty input", () => {
  assert.throws(() => safeCalculate(""));
});

test("rejects unbalanced parentheses", () => {
  assert.throws(() => safeCalculate("(2 + 3"));
});
