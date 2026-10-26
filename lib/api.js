import { timingSafeEqual } from "node:crypto";
import { db, ensureSchema } from "./db.js";

const MAX_FAILS = 5;

function pinOk(given) {
  const expected = process.env.APP_PIN;
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

/* Wraps every endpoint: sets up the schema, enforces the PIN and its rate limit, then runs the handler. */
export function withAuth(handler) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!process.env.APP_PIN) return res.status(500).json({ error: "APP_PIN is not set" });
    try {
      await ensureSchema();
      const p = db();
      const ip = clientIp(req);

      const { rows } = await p.query(
        "SELECT 1 FROM pin_attempts WHERE ip = $1 AND fails >= $2 AND last > now() - interval '15 minutes'",
        [ip, MAX_FAILS]
      );
      if (rows.length) return res.status(429).json({ error: "Too many attempts. Wait 15 minutes." });

      if (!pinOk(req.headers["x-pin"])) {
        await p.query(
          `INSERT INTO pin_attempts (ip, fails, last) VALUES ($1, 1, now())
           ON CONFLICT (ip) DO UPDATE SET
             fails = CASE WHEN pin_attempts.last < now() - interval '15 minutes' THEN 1 ELSE pin_attempts.fails + 1 END,
             last = now()`,
          [ip]
        );
        return res.status(401).json({ error: "Wrong PIN" });
      }
      await p.query("DELETE FROM pin_attempts WHERE ip = $1", [ip]);

      return await handler(req, res, p);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }
  };
}
