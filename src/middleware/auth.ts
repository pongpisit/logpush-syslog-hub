import type { Context, Next } from "hono";

/**
 * Constant-time comparison of two secrets. Hashes both inputs to a fixed
 * length with SHA-256 before comparing so that neither the length nor the
 * content of the secret leaks via timing.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(digestA, digestB);
}

/**
 * Hono middleware factory: requires `Authorization: Bearer <secret>` where
 * `<secret>` matches the value of the given env binding name.
 */
export function bearerAuth(envKey: "INGEST_SECRET" | "ADMIN_SECRET") {
  return async (c: Context, next: Next) => {
    const expected = (c.env as Record<string, string | undefined>)[envKey];
    if (!expected) {
      return c.json({ error: `Server misconfiguration: ${envKey} is not set` }, 500);
    }

    const header = c.req.header("Authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const valid = await timingSafeEqual(token, expected);
    if (!valid) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  };
}
