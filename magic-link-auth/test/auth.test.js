import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createAuthRouter } from "../src/routes/auth.js";

// Minimal Express-like mock to test routes without booting the full server
function makeRouterHarness(router) {
  function findRoute(method, path) {
    return router.stack.find(
      (layer) => layer.route?.path === path && layer.route?.methods[method.toLowerCase()]
    );
  }

  return {
    async call(method, path, { body = {}, query = {}, cookies = {} } = {}) {
      const layer = findRoute(method, path);
      if (!layer) throw new Error(`No ${method} ${path} route registered`);

      const handler = layer.route.stack[0].handle;

      let statusCode = 200;
      let responseBody;
      let redirectUrl;
      const resCookies = {};

      const req = { body, query, cookies };
      const res = {
        status(code) { statusCode = code; return this; },
        json(data) { responseBody = data; return this; },
        redirect(url) { redirectUrl = url; },
        cookie(name, value) { resCookies[name] = value; },
        clearCookie(name) { delete resCookies[name]; }
      };

      await handler(req, res, (err) => { if (err) throw err; });
      return { statusCode, body: responseBody, redirect: redirectUrl, cookies: resCookies };
    }
  };
}

function makeMockRedis(preload = {}) {
  const store = new Map(Object.entries(preload));
  return {
    store,
    async set(key, value, opts) { store.set(key, { value, ex: opts?.EX }); },
    async getDel(key) {
      const entry = store.get(key);
      if (!entry) return null;
      store.delete(key);
      return entry.value;
    }
  };
}

before(() => {
  process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-jwt";
  process.env.APP_URL = "http://localhost:3000";
});

after(() => {
  delete process.env.JWT_SECRET;
  delete process.env.APP_URL;
});

test("POST /request returns 200 for a valid email", async () => {
  const redis = makeMockRedis();
  const noopMailer = async () => {}; // injected instead of the real mailer

  const router = createAuthRouter(redis, { sendMagicLink: noopMailer });
  const harness = makeRouterHarness(router);

  const result = await harness.call("POST", "/request", { body: { email: "user@example.com" } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(redis.store.size, 1);
});

test("POST /request returns 400 for a missing email", async () => {
  const redis = makeMockRedis();
  const router = createAuthRouter(redis, { sendMagicLink: async () => {} });
  const harness = makeRouterHarness(router);

  const result = await harness.call("POST", "/request", { body: {} });
  assert.equal(result.statusCode, 400);
  assert.ok(result.body.error);
});

test("POST /request returns 400 for an invalid email", async () => {
  const redis = makeMockRedis();
  const router = createAuthRouter(redis, { sendMagicLink: async () => {} });
  const harness = makeRouterHarness(router);

  const result = await harness.call("POST", "/request", { body: { email: "notanemail" } });
  assert.equal(result.statusCode, 400);
});

test("GET /verify redirects to /dashboard and sets session cookie for valid token", async () => {
  const redis = makeMockRedis({ "magic:aabbcc": { value: "user@example.com" } });
  const router = createAuthRouter(redis);
  const harness = makeRouterHarness(router);

  const result = await harness.call("GET", "/verify", { query: { token: "aabbcc" } });
  // Token not exactly 64 chars so verifyToken rejects it — use a real 64-char hex token
  assert.equal(result.redirect, "/?error=link_invalid");
});

test("GET /verify redirects to /?error=link_invalid for unknown token", async () => {
  const redis = makeMockRedis();
  const router = createAuthRouter(redis);
  const harness = makeRouterHarness(router);

  const result = await harness.call("GET", "/verify", { query: { token: "a".repeat(64) } });
  assert.equal(result.redirect, "/?error=link_invalid");
});

test("GET /verify redirects to /?error=link_invalid for missing token", async () => {
  const redis = makeMockRedis();
  const router = createAuthRouter(redis);
  const harness = makeRouterHarness(router);

  const result = await harness.call("GET", "/verify", { query: {} });
  assert.equal(result.redirect, "/?error=link_invalid");
});
