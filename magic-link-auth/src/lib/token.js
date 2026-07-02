import crypto from "node:crypto";

const TOKEN_PREFIX = "magic:";
const TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const TOKEN_BYTES = 32;

/**
 * Generates a cryptographically secure token and stores it in Redis
 * against the given email with a 15-minute TTL.
 *
 * @param {object} redis - A connected redis client
 * @param {string} email
 * @returns {Promise<string>} The raw token (to embed in the magic link URL)
 */
export async function createToken(redis, email) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const key = TOKEN_PREFIX + token;
  await redis.set(key, email.toLowerCase(), { EX: TOKEN_TTL_SECONDS });
  return token;
}

/**
 * Verifies a token and returns the associated email if valid.
 * The token is deleted immediately on first use — single-use enforced.
 *
 * @param {object} redis - A connected redis client
 * @param {string} token
 * @returns {Promise<string|null>} The email, or null if invalid/expired
 */
export async function verifyToken(redis, token) {
  if (!token || typeof token !== "string" || token.length !== TOKEN_BYTES * 2) {
    return null;
  }

  const key = TOKEN_PREFIX + token;

  // getdel: atomic get-and-delete. Prevents a race where two simultaneous
  // requests with the same token both read before either deletes.
  const email = await redis.getDel(key);
  return email ?? null;
}

export { TOKEN_TTL_SECONDS };
