# 2FA NestJS Demo

A working TOTP-based two-factor authentication implementation built with **NestJS**, **Passport**, **TypeORM**, and **PostgreSQL**. Every endpoint below was tested end-to-end against a real Postgres instance before this was published — register → enable 2FA → scan QR → verify TOTP code → login with 2FA → backup codes → disable 2FA.

## Stack

- NestJS 10 (Express adapter)
- PostgreSQL + TypeORM
- Passport + `@nestjs/jwt` (JWT auth)
- [`otpauth`](https://www.npmjs.com/package/otpauth) — TOTP generation/verification
- [`qrcode`](https://www.npmjs.com/package/qrcode) — renders the otpauth:// URI as a scannable QR code
- `bcryptjs` — password and backup-code hashing (pure JS, no native build step)

## How the flow works

1. **Register / login** — standard email + password. If the account doesn't have 2FA enabled, login returns a full access token immediately.
2. **Enable 2FA** (`/auth/2fa/generate` → `/auth/2fa/turn-on`) — generates a secret, returns a QR code to scan, then requires one valid code from the app before turning 2FA on. Turning it on returns a set of one-time backup codes. **Both routes require a fully-authenticated session** (`JwtTwoFactorGuard`), not just any valid token — see the security note below on why.
3. **Login with 2FA enabled** — `/auth/login` now returns a *partial* token (`isSecondFactorAuthenticated: false`). That token is accepted by exactly one route: `/auth/2fa/authenticate`.
4. **Second factor** (`/auth/2fa/authenticate`) — accepts either a live 6-digit TOTP code or one of the backup codes. On success, issues a full access token. Backup codes are deleted after a single use.
5. **Protected routes** use `JwtTwoFactorGuard`, which rejects any token where `isSecondFactorAuthenticated` is not `true`.

## Setup

```bash
npm install
cp .env.example .env   # then fill in JWT_SECRET and your DB credentials
```

You need a running Postgres instance. Locally, the quickest way is Docker:

```bash
docker run --name twofa-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=twofa_demo -p 5432:5432 -d postgres:16
```

Then start the API:

```bash
npm run start:dev
```

`synchronize: true` is enabled in `app.module.ts` for convenience — it creates the `user` table automatically on first boot. **Turn this off and use real migrations before deploying.**

## API walkthrough (curl)

```bash
# 1. Register
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"correct-horse-battery"}'

# 2. Log in — 2FA isn't enabled yet, so this returns a full access token
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"correct-horse-battery"}'
# -> { "accessToken": "...", "twoFactorRequired": false }

# 3. Generate a 2FA secret + QR code (use that token)
curl -X POST http://localhost:3000/auth/2fa/generate \
  -H "Authorization: Bearer <accessToken>"
# -> { "qrCodeDataUrl": "data:image/png;base64,..." }
# Paste the data URL into a browser address bar, or render it in an <img> tag,
# and scan it with Google Authenticator / Authy / 1Password etc.

# 4. Confirm setup with a live code from the app
curl -X POST http://localhost:3000/auth/2fa/turn-on \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"twoFactorAuthCode":"123456"}'
# -> { "message": "2FA enabled...", "backupCodes": ["a1b2c3d4e5", ...] }
# Show these to the user ONCE. They are not recoverable after this response.

# 5. Log in again — now a PARTIAL token comes back
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"correct-horse-battery"}'
# -> { "accessToken": "...", "twoFactorRequired": true }

# 6. Exchange the partial token + a TOTP or backup code for a full token
curl -X POST http://localhost:3000/auth/2fa/authenticate \
  -H "Authorization: Bearer <partialAccessToken>" \
  -H "Content-Type: application/json" \
  -d '{"twoFactorAuthCode":"123456"}'
# -> { "accessToken": "<full token>" }

# 7. Use the full token on a protected route
curl http://localhost:3000/auth/me -H "Authorization: Bearer <fullAccessToken>"

# 8. Disable 2FA (requires a full token + a current valid code)
curl -X POST http://localhost:3000/auth/2fa/turn-off \
  -H "Authorization: Bearer <fullAccessToken>" \
  -H "Content-Type: application/json" \
  -d '{"twoFactorAuthCode":"123456"}'
```

## Security notes for production use

These were deliberately kept simple for a demo. Before shipping this for real:

- **Why `/2fa/generate` and `/2fa/turn-on` require a full token.** It's tempting to guard these with the same "any valid token" check as `/2fa/authenticate`, since a brand-new user technically only has a partial-looking token at that point too. But a *partial* token (`isSecondFactorAuthenticated: false`) is only ever issued for accounts that **already** have 2FA enabled. If those two routes accepted a partial token, anyone holding just a stolen password could log in, immediately overwrite the account's TOTP secret and backup codes with ones they control, and fully hijack 2FA without ever knowing the original second factor. New users setting up 2FA for the first time aren't affected — `isTwoFactorEnabled` is still `false` for them, so login already gives them a full token. This repo's guards are set up correctly (`JwtTwoFactorGuard` on `/generate`, `/turn-on`, and `/turn-off`); if you refactor this, keep that invariant.
- **Encrypt the TOTP secret at rest.** It's stored as plaintext in `twoFactorSecret` here for clarity. In production, encrypt it with a KMS-backed key (AWS KMS, GCP KMS, Vault) rather than relying on column-level access control alone.
- **Rate-limit `/auth/login` and `/auth/2fa/authenticate`.** Both are brute-force targets. Add `@nestjs/throttler` or a similar guard.
- **Shorten the partial token's lifetime**, or issue it with a distinct, shorter `expiresIn` than a fully authenticated session — it shouldn't outlive a normal login attempt.
- **Never log the TOTP code, secret, or backup codes** — even in error messages or request logs.
- **Consider WebAuthn/passkeys** as an additional or alternative factor. TOTP is solid and broadly compatible, but passkeys remove phishability entirely.
- **Re-require the password** (not just a TOTP code) before disabling 2FA, to protect against a stolen, still-valid session token.

## Project structure

```
src/
├── app.module.ts
├── main.ts
├── users/
│   ├── user.entity.ts
│   ├── users.module.ts
│   └── users.service.ts
└── auth/
    ├── auth.module.ts
    ├── auth.controller.ts
    ├── auth.service.ts
    ├── two-factor-auth.service.ts   # TOTP, QR code, backup codes
    ├── dto/
    ├── guard/
    │   ├── jwt-auth.guard.ts         # any valid token (full or partial)
    │   └── jwt-two-factor.guard.ts   # requires isSecondFactorAuthenticated: true
    ├── strategy/jwt.strategy.ts
    └── types/jwt-payload.interface.ts
```
