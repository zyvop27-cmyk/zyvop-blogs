import jwt from "jsonwebtoken";

const COOKIE_NAME = "session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 characters long");
  }
  return secret;
}

/**
 * Issues a signed JWT and sets it as an httpOnly, Secure, SameSite=Lax cookie.
 *
 * @param {object} res - Express response object
 * @param {string} email
 */
export function issueSession(res, email) {
  const token = jwt.sign({ email }, getSecret(), {
    expiresIn: SESSION_TTL_SECONDS
  });

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS * 1000
  });
}

/**
 * Express middleware that validates the session cookie.
 * Attaches { email } to req.user if valid, returns 401 otherwise.
 */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ error: "Not authenticated." });
  }

  try {
    const payload = jwt.verify(token, getSecret());
    req.user = { email: payload.email };
    next();
  } catch {
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

export { COOKIE_NAME, SESSION_TTL_SECONDS };
