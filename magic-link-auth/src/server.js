import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { createClient } from "redis";
import { createAuthRouter } from "./routes/auth.js";
import { requireAuth } from "./lib/session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

async function main() {
  // --- Redis ---
  const redis = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379"
  });

  redis.on("error", (err) => console.error("[redis]", err.message));
  await redis.connect();
  console.log("[redis] connected");

  // --- Express ---
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, "..", "public")));

  // Limit magic link requests to 5 per 15 minutes per IP.
  // This is the primary defense against email flooding.
  const requestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Please wait 15 minutes and try again." }
  });

  // --- Routes ---
  app.use("/auth", requestLimiter, createAuthRouter(redis));

  // Protected route — only reachable with a valid session cookie
  app.get("/dashboard", requireAuth, (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Dashboard</title>
        <style>
          body { font-family: sans-serif; max-width: 480px; margin: 80px auto; padding: 0 16px; }
          a { color: #111; }
        </style>
      </head>
      <body>
        <h2>You're signed in</h2>
        <p>Signed in as <strong>${req.user.email}</strong></p>
        <form action="/auth/logout" method="POST">
          <button type="submit">Sign out</button>
        </form>
      </body>
      </html>
    `);
  });

  // API route — returns the current user if authenticated, for JS clients
  app.get("/api/me", requireAuth, (req, res) => {
    res.json({ email: req.user.email });
  });

  app.get("/healthz", (_, res) => res.json({ ok: true }));

  app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
