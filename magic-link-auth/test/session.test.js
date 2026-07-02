import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { issueSession, requireAuth } from "../src/lib/session.js";

const TEST_SECRET = "test-secret-that-is-long-enough-for-jwt";

before(() => {
  process.env.JWT_SECRET = TEST_SECRET;
});

after(() => {
  delete process.env.JWT_SECRET;
});

function makeMockRes() {
  const cookies = {};
  return {
    cookies,
    cookie(name, value) { cookies[name] = value; },
    clearCookie(name) { delete cookies[name]; },
    status() { return this; },
    json() { return this; }
  };
}

function makeMockReq(token) {
  return { cookies: token ? { session: token } : {} };
}

test("issueSession sets a session cookie", () => {
  const res = makeMockRes();
  issueSession(res, "user@example.com");
  assert.ok(res.cookies.session, "session cookie should be set");
});

test("issueSession cookie contains the correct email payload", () => {
  const res = makeMockRes();
  issueSession(res, "user@example.com");
  const payload = jwt.verify(res.cookies.session, TEST_SECRET);
  assert.equal(payload.email, "user@example.com");
});

test("requireAuth calls next() with valid session", (t, done) => {
  const res = makeMockRes();
  issueSession(res, "user@example.com");

  const req = makeMockReq(res.cookies.session);
  requireAuth(req, makeMockRes(), () => {
    assert.equal(req.user.email, "user@example.com");
    done();
  });
});

test("requireAuth returns 401 with no session cookie", (t, done) => {
  const req = makeMockReq(null);
  let statusCode;
  const res = {
    status(code) { statusCode = code; return this; },
    json() { assert.equal(statusCode, 401); done(); return this; }
  };
  requireAuth(req, res, () => assert.fail("next should not be called"));
});

test("requireAuth returns 401 with an expired token", (t, done) => {
  const expiredToken = jwt.sign({ email: "user@example.com" }, TEST_SECRET, { expiresIn: -1 });
  const req = makeMockReq(expiredToken);
  let statusCode;
  const res = {
    cookies: {},
    clearCookie(name) { delete this.cookies[name]; },
    status(code) { statusCode = code; return this; },
    json() { assert.equal(statusCode, 401); done(); return this; }
  };
  requireAuth(req, res, () => assert.fail("next should not be called"));
});

test("requireAuth returns 401 with a tampered token", (t, done) => {
  const req = makeMockReq("not.a.real.jwt");
  let statusCode;
  const res = {
    cookies: {},
    clearCookie() {},
    status(code) { statusCode = code; return this; },
    json() { assert.equal(statusCode, 401); done(); return this; }
  };
  requireAuth(req, res, () => assert.fail("next should not be called"));
});
