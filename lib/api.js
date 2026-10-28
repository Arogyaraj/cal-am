import { timingSafeEqual } from "node:crypto";
import { db, ensureSchema } from "./db.js";

const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

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

/* Wraps every endpoint: checks the schema version, enforces the PIN and its rate limit, then runs the handler. */
export function withAuth(handler) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!process.env.APP_PIN) return res.status(500).json({ error: "APP_PIN is not set" });
    try {
      await ensureSchema();
      const p = db();
      const ip = clientIp(req);

      const { rows } = await p.query("SELECT fails, last FROM pin_attempts WHERE ip = $1", [ip]);
      const row = rows[0];
      if (row && row.fails >= MAX_FAILS && Date.now() - new Date(row.last).getTime() < WINDOW_MS) {
        return res.status(429).json({ error: "Too many attempts. Wait 15 minutes." });
      }

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
      if (row) await p.query("DELETE FROM pin_attempts WHERE ip = $1", [ip]);

      return await handler(req, res, p);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }
  };
}
