# Rate Limiting & Brute-Force Protection in NestJS

Two independent, complementary defenses for a login endpoint, built with **NestJS**, **`@nestjs/throttler`**, **Redis**, and **PostgreSQL**:

1. **IP-based rate limiting** — stops one source from hammering the endpoint at volume.
2. **Account-based lockout** — stops repeated password guessing against *one specific account*, regardless of which IP (or how many different IPs) the attempts come from.

Every behavior described below — the lockout cycle, the unaffected-neighbor account, the lock expiring into a genuine fresh start, and the IP throttle tripping — was run end-to-end against a live server, real Postgres, and real Redis before this was published.

## Why two mechanisms, not one

IP throttling alone doesn't stop a distributed attack: an attacker guessing passwords against one account from many different IPs (or just spacing requests out) never repeats an IP often enough to trip a per-IP limit. Account lockout alone doesn't stop someone hammering the endpoint itself, trying many different (mostly nonexistent) accounts to enumerate valid emails or just to generate load. Each mechanism catches what the other misses.

## Stack

- NestJS 10 (Express adapter)
- [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting) v6 — IP-based rate limiting
- Redis (via `ioredis` directly) — backs the account-lockout counters
- PostgreSQL + TypeORM — user storage
- `bcryptjs` — password hashing (pure JS, no native build step)

## How it works

**IP throttling** (`@nestjs/throttler`) is applied globally (20 requests/60s per IP, every route) via `APP_GUARD`, with `/auth/login` overriding that to a stricter 10 requests/60s given it's a more sensitive target. This is orthogonal to anything below — it doesn't know or care about the request body, only how many requests a given IP has made recently.

**Account lockout** (`LoginAttemptService`) tracks failed attempts in Redis, keyed by email:

- Each failed login increments `login-attempts:{email}`. The counter's TTL is set only on the *first* failure of a streak — later failures increment it without resetting that expiry.
- Once failures reach `LOGIN_LOCKOUT_MAX_ATTEMPTS` (default 5), a separate `login-lock:{email}` key is set with its own TTL (`LOGIN_LOCKOUT_DURATION_SECONDS`).
- Any successful login deletes both keys — a real, complete reset, not just letting them expire naturally.
- **The lock isn't revealed on the attempt that triggers it.** The 5th failure still returns a plain "Invalid credentials" — the same response as failures 1-4. The lock only becomes visible on the *next* attempt, including one with the correct password. This avoids telegraphing "that was your last try" to whoever's attempting the login.

### A TTL interaction worth knowing about

`LOGIN_LOCKOUT_WINDOW_SECONDS` (how long the failure counter lives) and `LOGIN_LOCKOUT_DURATION_SECONDS` (how long the lock itself lives) default to the **same value** on purpose. Here's why, verified directly: if the attempts window outlives the lock, the counter is still sitting at its old value the moment the lock expires — so a single additional failure right after unlock immediately re-locks the account, because the counter never actually reset to zero. With the two TTLs equal, the counter and the lock expire together, so unlocking really means a fresh start. If you want progressively harsher lockouts for someone who keeps failing right after each unlock, setting the window longer than the lock duration is a legitimate, deliberate way to get that — just know that's what you're choosing.

## Setup

```bash
npm install
cp .env.example .env
```

You need both Postgres and Redis running locally:

```bash
docker run --name rl-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ratelimit_demo -p 5432:5432 -d postgres:16
docker run --name rl-redis -p 6379:6379 -d redis:7
```

Then start the API:

```bash
npm run start:dev
```

`synchronize: true` is enabled in `app.module.ts` for this demo, so the `user` table is created automatically on first boot. **Turn this off and use real migrations before deploying.**

The `.env.example` lockout values (5 attempts, 15-minute window/lock) are realistic production defaults. If you want to replicate the timings in the walkthrough below without waiting 15 minutes, temporarily lower `LOGIN_LOCKOUT_WINDOW_SECONDS` and `LOGIN_LOCKOUT_DURATION_SECONDS` (e.g., to `8`) in your own `.env`.

## API walkthrough (curl)

```bash
# Register a couple of users
curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"correct-horse-battery"}'
curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" \
  -d '{"email":"bob@example.com","password":"correct-horse-battery"}'
```

```bash
# Fail alice's login 4 times — each is a plain 401, same as any wrong password
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"wrong-password"}'
# -> 401 {"message":"Invalid credentials", ...}   (repeat 4x)

# The 5th failure crosses the lockout threshold, but still just reads as a 401 —
# the lock isn't revealed until the NEXT attempt
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"wrong-password"}'
# -> 401 {"message":"Invalid credentials", ...}

# Now try the CORRECT password — still rejected, because the account is locked
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"correct-horse-battery"}'
# -> 429 {"statusCode":429,"message":"Account temporarily locked after too many failed attempts. Try again in Ns.","reason":"ACCOUNT_LOCKED"}
```

```bash
# bob is completely unaffected — the lock is scoped to alice's email, not the IP
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"bob@example.com","password":"correct-horse-battery"}'
# -> 201 { "accessToken": "..." }
```

```bash
# After the lock's duration passes, alice gets a genuine fresh start
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"correct-horse-battery"}'
# -> 201 { "accessToken": "..." }
```

```bash
# IP throttle: /login is overridden to 10 requests/60s per IP, independent of
# the account-lockout mechanism above. Note this counts EVERY call to /login
# from your IP within the window, including all the ones above — so if you've
# just run the full sequence above, you'll trip this well before 10 fresh
# requests, because those earlier calls already count toward the same window.
curl -i -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"anyone@example.com","password":"anything"}'
# successful responses carry: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
# once the limit's crossed:
# -> 429 {"statusCode":429,"message":"ThrottlerException: Too Many Requests"}
```

The account-lockout 429 and the IP-throttle 429 share a status code but are deliberately distinguishable in the body — the lockout response includes `"reason":"ACCOUNT_LOCKED"` and a human-readable retry time; the throttler's is the generic `ThrottlerException` message. A client (or a reader of your logs) can tell them apart without guessing.

## Production notes

- **These lockout defaults (5 attempts / 15 min) are a starting point, not a universal answer.** Tune them against your actual threat model and how forgiving you want to be with legitimate users who mistype a password a few times.
- **Consider notifying the user on lockout** (email: "we noticed repeated failed login attempts on your account") — it's both a security signal to a legitimate owner and a deterrent, though it adds a notification dependency this demo deliberately leaves out.
- **The throttler's default error message (`"ThrottlerException: Too Many Requests"`) is a bit rough for a real API.** `@nestjs/throttler` supports a custom exception factory if you want a cleaner, more consistent error shape across both mechanisms.
- **In a multi-instance deployment, the default in-memory throttler storage won't share state across instances** — one instance's counters don't know about another's. `@nestjs/throttler` supports pluggable storage (including Redis-backed options) for exactly this reason; this demo uses the default in-memory storage for simplicity, which is fine for a single instance but not for a horizontally-scaled one.
- **Consider adding a CAPTCHA after N failures** as a third layer for public-facing login forms — it's a different kind of friction than either mechanism here and catches automated attempts that are patient enough to stay under both thresholds.

## Project structure

```
src/
├── app.module.ts        # wires Postgres and the global ThrottlerModule/APP_GUARD
├── main.ts
├── users/
│   ├── user.entity.ts
│   ├── users.module.ts
│   └── users.service.ts
└── auth/
    ├── auth.module.ts
    ├── auth.controller.ts        # /auth/login combines both mechanisms
    ├── auth.service.ts           # password hashing, JWT issuance
    ├── login-attempt.service.ts  # the Redis-backed account lockout
    └── dto/
```
