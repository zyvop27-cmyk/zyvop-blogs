import { Router } from "express";
import { createToken, verifyToken } from "../lib/token.js";
import { sendMagicLink as defaultSendMagicLink } from "../lib/mailer.js";
import { issueSession } from "../lib/session.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createAuthRouter(redis, { sendMagicLink = defaultSendMagicLink } = {}) {
  const router = new Router();

  /**
   * POST /auth/request
   * Body: { email: string }
   *
   * Generates a magic link token, stores it in Redis, and sends the email.
   * Always returns 200 regardless of whether the email exists — this prevents
   * user enumeration (leaking which emails are registered).
   */
  router.post("/request", async (req, res) => {
    const email = (req.body?.email ?? "").trim().toLowerCase();

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "A valid email address is required." });
    }

    // Rate-limit check is handled at the Express level (see server.js).
    // We don't do per-email throttling here to avoid timing-based enumeration.

    try {
      const token = await createToken(redis, email);
      const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
      const magicUrl = `${appUrl}/auth/verify?token=${token}`;

      await sendMagicLink(email, magicUrl);

      res.json({ ok: true, message: "Check your inbox for a sign-in link." });
    } catch (err) {
      console.error("[auth] request failed:", err);
      res.status(500).json({ error: "Failed to send the sign-in link. Please try again." });
    }
  });

  /**
   * GET /auth/verify?token=<token>
   *
   * Validates the token, consumes it (single-use), issues a session cookie,
   * then redirects to the dashboard. On failure, redirects to /?error=...
   * so the HTML page can show a human-readable message.
   */
  router.get("/verify", async (req, res) => {
    const { token } = req.query;

    const email = await verifyToken(redis, token);

    if (!email) {
      return res.redirect("/?error=link_invalid");
    }

    issueSession(res, email);
    res.redirect("/dashboard");
  });

  /**
   * POST /auth/logout
   * Clears the session cookie.
   */
  router.post("/logout", (req, res) => {
    res.clearCookie("session");
    res.redirect("/");
  });

  return router;
}
