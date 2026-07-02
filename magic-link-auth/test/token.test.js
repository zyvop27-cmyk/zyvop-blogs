import { test } from "node:test";
import assert from "node:assert/strict";
import { createToken, verifyToken } from "../src/lib/token.js";

function makeMockRedis() {
  const store = new Map();
  return {
    store,
    async set(key, value, opts) {
      store.set(key, { value, ex: opts?.EX });
    },
    async getDel(key) {
      const entry = store.get(key);
      if (!entry) return null;
      store.delete(key);
      return entry.value;
    }
  };
}

test("createToken stores the email in Redis and returns a 64-char hex string", async () => {
  const redis = makeMockRedis();
  const token = await createToken(redis, "user@example.com");

  assert.equal(typeof token, "string");
  assert.equal(token.length, 64);
  assert.match(token, /^[0-9a-f]+$/);

  // Exactly one entry in the store
  assert.equal(redis.store.size, 1);
  const [key, entry] = [...redis.store.entries()][0];
  assert.ok(key.startsWith("magic:"));
  assert.equal(entry.value, "user@example.com");
  assert.equal(entry.ex, 15 * 60);
});

test("createToken lowercases the email before storing", async () => {
  const redis = makeMockRedis();
  await createToken(redis, "User@Example.COM");
  const [, entry] = [...redis.store.entries()][0];
  assert.equal(entry.value, "user@example.com");
});

test("verifyToken returns the email and deletes the token on first use", async () => {
  const redis = makeMockRedis();
  const token = await createToken(redis, "user@example.com");

  const email = await verifyToken(redis, token);
  assert.equal(email, "user@example.com");

  // Token must be gone after first use
  assert.equal(redis.store.size, 0);
});

test("verifyToken returns null for an unknown token", async () => {
  const redis = makeMockRedis();
  const result = await verifyToken(redis, "a".repeat(64));
  assert.equal(result, null);
});

test("verifyToken returns null for a token used twice (single-use enforced)", async () => {
  const redis = makeMockRedis();
  const token = await createToken(redis, "user@example.com");

  await verifyToken(redis, token); // first use — valid
  const second = await verifyToken(redis, token); // second use — must be null
  assert.equal(second, null);
});

test("verifyToken returns null for tokens with wrong length", async () => {
  const redis = makeMockRedis();
  assert.equal(await verifyToken(redis, "tooshort"), null);
  assert.equal(await verifyToken(redis, "a".repeat(63)), null);
  assert.equal(await verifyToken(redis, "a".repeat(65)), null);
});

test("verifyToken returns null for empty or non-string input", async () => {
  const redis = makeMockRedis();
  assert.equal(await verifyToken(redis, ""), null);
  assert.equal(await verifyToken(redis, null), null);
  assert.equal(await verifyToken(redis, undefined), null);
});
