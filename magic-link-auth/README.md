# Magic Link Auth — Node.js

Passwordless authentication using magic links. Enter your email, get a link, click it, you're in. No password required.

Built with Express, Redis, Nodemailer, and JWT. No auth framework.

## How it works

1. User submits their email on the sign-in page
2. Server generates a secure random token, stores it in Redis with a 15-minute TTL
3. Server emails a link containing the token (`/auth/verify?token=...`)
4. User clicks the link — the token is verified, consumed (single-use), and a session cookie is set
5. Subsequent requests use the JWT session cookie

## Stack

- **Express 5** — HTTP server
- **Redis** — token storage with TTL (swap for any KV store)
- **Nodemailer** — sends the magic link email (Ethereal for local dev, real SMTP for production)
- **jsonwebtoken** — session management via httpOnly cookie
- **express-rate-limit** — 5 requests per 15 minutes per IP on the auth endpoint

## Setup

```bash
npm install
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET
```

Start Redis (Docker is the quickest):
```bash
docker run -p 6379:6379 redis:alpine
```

Start the server:
```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000), enter any email address.

Without SMTP configured, the server uses Ethereal and logs a preview URL — open it in your browser to see the email and click the magic link.

## Tests

```bash
npm test
```

19 tests covering token generation, single-use enforcement, session issuance, middleware auth checks, and route validation. No Redis or SMTP connection needed.

## Project layout

```
src/
  server.js          Express app, Redis connection, rate limiting
  routes/
    auth.js          POST /auth/request, GET /auth/verify, POST /auth/logout
  lib/
    token.js         Generate and verify magic link tokens (Redis-backed)
    mailer.js        Send magic link email via Nodemailer
    session.js       Issue and verify JWT sessions (httpOnly cookie)
public/
  index.html         Sign-in page
test/
  token.test.js
  session.test.js
  auth.test.js
```

## Curl examples

```bash
# Request a magic link
curl -X POST http://localhost:3000/auth/request \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'

# {"ok":true,"message":"Check your inbox for a sign-in link."}

# Check who you're signed in as (after clicking the link)
curl -b cookies.txt http://localhost:3000/api/me

# {"email":"you@example.com"}
```

## Taking this to production

- Set `NODE_ENV=production` — this enables the `Secure` flag on the session cookie
- Use a strong, random `JWT_SECRET` (see `.env.example` for the generation command)
- Point `REDIS_URL` at a managed Redis instance (Redis Cloud, Upstash, etc.)
- Configure real SMTP credentials (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`)
- Put the server behind a reverse proxy (nginx/Caddy) for TLS — the `Secure` cookie flag requires HTTPS

## License

MIT
