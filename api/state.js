import { neon } from "@neondatabase/serverless";
import { timingSafeEqual } from "node:crypto";

const MAX_FAILS = 5;

async function ensureTables(sql) {
  await sql`CREATE TABLE IF NOT EXISTS bucketlist (
    id text PRIMARY KEY,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS pin_attempts (
    ip text PRIMARY KEY,
    fails int NOT NULL DEFAULT 0,
    last timestamptz NOT NULL DEFAULT now()
  )`;
}

async function isLocked(sql, ip) {
  const rows = await sql`SELECT ip FROM pin_attempts
    WHERE ip = ${ip} AND fails >= ${MAX_FAILS} AND last > now() - interval '15 minutes'`;
  return rows.length > 0;
}

async function recordFail(sql, ip) {
  await sql`INSERT INTO pin_attempts (ip, fails, last) VALUES (${ip}, 1, now())
    ON CONFLICT (ip) DO UPDATE SET
      fails = CASE WHEN pin_attempts.last < now() - interval '15 minutes' THEN 1 ELSE pin_attempts.fails + 1 END,
      last = now()`;
}

async function clearFails(sql, ip) {
  await sql`DELETE FROM pin_attempts WHERE ip = ${ip}`;
}

function pinOk(given) {
  const expected = process.env.APP_PIN;
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!process.env.APP_PIN || !url) {
    return res.status(500).json({ error: "Server not configured" });
  }

  const sql = neon(url);
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";

  try {
    await ensureTables(sql);

    if (await isLocked(sql, ip)) {
      return res.status(429).json({ error: "Too many attempts" });
    }
    if (!pinOk(req.headers["x-pin"])) {
      await recordFail(sql, ip);
      return res.status(401).json({ error: "Wrong PIN" });
    }
    await clearFails(sql, ip);

    if (req.method === "GET") {
      const rows = await sql`SELECT data FROM bucketlist WHERE id = 'main'`;
      return res.status(200).json({ state: rows[0]?.data ?? null });
    }

    if (req.method === "PUT") {
      const state = req.body;
      if (!state || typeof state !== "object" || !Array.isArray(state.items)) {
        return res.status(400).json({ error: "Invalid state" });
      }
      const json = JSON.stringify(state);
      await sql`INSERT INTO bucketlist (id, data, updated_at)
        VALUES ('main', ${json}::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Database error" });
  }
}
