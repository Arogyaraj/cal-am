import pg from "pg";
import { randomUUID } from "node:crypto";

const { Pool } = pg;
export const CATS = ["Travel","Adventure","Learning","Health","Career","Creative","Food","Experiences","Other"];
const PRIOS = ["high", "medium", "low"];
const MAX_PHOTO = 400000;

let pool = null;
let ready = null;

export function db() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) throw new Error("No database URL configured");
    pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 10000 });
  }
  return pool;
}

const str = (v, max) => String(v ?? "").trim().slice(0, max);

function cleanUrl(v) {
  const s = str(v, 300);
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}

const cleanPhoto = (v) => (typeof v === "string" && v.startsWith("data:image/") && v.length < MAX_PHOTO ? v : "");

/* Validates and normalizes any incoming dream. Bad or unknown values are dropped, never trusted. */
export function sanitize(raw = {}) {
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .slice(0, 40)
    .map((s) => ({ id: str(s?.id, 40) || randomUUID(), text: str(s?.text, 200), done: !!s?.done }))
    .filter((s) => s.text);
  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .map((t) => str(t, 30).replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 10);
  const done = !!raw.done;
  const rating = Math.round(Number(raw.rating));
  const emoji = Array.from(String(raw.emoji ?? "").trim()).slice(0, 4).join("");
  return {
    id: str(raw.id, 40) || randomUUID(),
    title: str(raw.title, 120) || "Untitled",
    category: CATS.includes(raw.category) ? raw.category : "Other",
    priority: PRIOS.includes(raw.priority) ? raw.priority : "medium",
    date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || "") ? raw.date : null,
    budget: str(raw.budget, 40),
    location: str(raw.location, 120),
    url: cleanUrl(raw.url),
    tags,
    notes: str(raw.notes, 2000),
    memory: str(raw.memory, 4000),
    photo: cleanPhoto(raw.photo),
    emoji,
    steps,
    pinned: !!raw.pinned,
    done,
    rating: done && rating >= 1 && rating <= 5 ? rating : null,
    added: Number(raw.added) > 0 ? Number(raw.added) : 0,
    completedAt: done ? (Number(raw.completedAt) > 0 ? Number(raw.completedAt) : Date.now()) : 0
  };
}

const COLS = `id, title, category, priority, to_char(target_date, 'YYYY-MM-DD') AS date, budget, location, url,
  tags, notes, memory, photo, emoji, steps, pinned, done, rating,
  (extract(epoch FROM created_at) * 1000)::float8 AS added,
  (extract(epoch FROM completed_at) * 1000)::float8 AS "completedAt"`;

export function mapDream(r) {
  return {
    id: r.id, title: r.title, category: r.category, priority: r.priority, date: r.date || "",
    budget: r.budget, location: r.location, url: r.url, tags: r.tags || [], notes: r.notes,
    memory: r.memory, photo: r.photo, emoji: r.emoji || "", steps: r.steps || [],
    pinned: r.pinned, done: r.done, rating: r.rating ? Number(r.rating) : null,
    added: Math.round(r.added || 0), completedAt: Math.round(r.completedAt || 0)
  };
}

export async function getDream(p, id) {
  const { rows } = await p.query(`SELECT ${COLS} FROM dreams WHERE id = $1`, [id]);
  return rows[0] ? mapDream(rows[0]) : null;
}

export async function listDreams(p) {
  const { rows } = await p.query(`SELECT ${COLS} FROM dreams ORDER BY pinned DESC, created_at DESC`);
  return rows.map(mapDream);
}

export async function insertDream(c, d) {
  await c.query(
    `INSERT INTO dreams (id, title, category, priority, target_date, budget, location, url, tags, notes, memory,
                         photo, steps, pinned, done, created_at, completed_at, emoji, rating)
     VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15,
       CASE WHEN $16::float8 > 0 THEN to_timestamp($16::float8 / 1000) ELSE now() END,
       CASE WHEN $17::float8 > 0 THEN to_timestamp($17::float8 / 1000) ELSE NULL END,
       $18, $19::smallint)
     ON CONFLICT (id) DO NOTHING`,
    [d.id, d.title, d.category, d.priority, d.date, d.budget, d.location, d.url, JSON.stringify(d.tags),
     d.notes, d.memory, d.photo, JSON.stringify(d.steps), d.pinned, d.done, d.added, d.completedAt, d.emoji, d.rating]
  );
}

export async function updateDream(c, d) {
  await c.query(
    `UPDATE dreams SET title=$2, category=$3, priority=$4, target_date=$5::date, budget=$6, location=$7, url=$8,
        tags=$9::jsonb, notes=$10, memory=$11, photo=$12, steps=$13::jsonb, pinned=$14, done=$15,
        emoji=$16, rating=$17::smallint,
        completed_at = CASE WHEN NOT $15::boolean THEN NULL
                            WHEN completed_at IS NULL THEN now()
                            ELSE completed_at END,
        updated_at = now()
     WHERE id = $1`,
    [d.id, d.title, d.category, d.priority, d.date, d.budget, d.location, d.url, JSON.stringify(d.tags),
     d.notes, d.memory, d.photo, JSON.stringify(d.steps), d.pinned, d.done, d.emoji, d.rating]
  );
}

export async function logActivity(c, dreamId, title, kind) {
  await c.query("INSERT INTO activity (dream_id, title, kind) VALUES ($1, $2, $3)", [dreamId, str(title, 120), kind]);
}

export async function listActivity(p) {
  const { rows } = await p.query(
    `SELECT dream_id AS "dreamId", title, kind, (extract(epoch FROM happened_at) * 1000)::float8 AS at
     FROM activity ORDER BY happened_at DESC LIMIT 80`
  );
  return rows.map((r) => ({ ...r, at: Math.round(r.at) }));
}

export async function getProfile(p) {
  const { rows } = await p.query("SELECT name, tagline, photo, goal FROM profile WHERE id = 1");
  return rows[0] ? { ...rows[0], goal: Number(rows[0].goal) || 0 } : { name: "Your Name", tagline: "", photo: "", goal: 0 };
}

export async function saveProfile(c, pr = {}) {
  const goal = Math.min(500, Math.max(0, Math.round(Number(pr.goal) || 0)));
  await c.query(
    `INSERT INTO profile (id, name, tagline, photo, goal) VALUES (1, $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tagline = EXCLUDED.tagline,
       photo = EXCLUDED.photo, goal = EXCLUDED.goal, updated_at = now()`,
    [str(pr.name, 60) || "Your Name", str(pr.tagline, 120), cleanPhoto(pr.photo), goal]
  );
}

export async function tx(p, fn) {
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/* Replaces the whole list. Used by backup import and by the one-time move from the old single-document table. */
export async function importState(p, data) {
  const items = (Array.isArray(data.items) ? data.items : []).slice(0, 1000).map(sanitize);
  await tx(p, async (c) => {
    await c.query("DELETE FROM dreams");
    await c.query("DELETE FROM activity");
    if (data.profile) await saveProfile(c, data.profile);
    for (const d of items) await insertDream(c, d);
  });
  return items.length;
}

export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const p = db();
      await p.query(`CREATE TABLE IF NOT EXISTS profile (
        id int PRIMARY KEY,
        name text NOT NULL DEFAULT 'Your Name',
        tagline text NOT NULL DEFAULT '',
        photo text NOT NULL DEFAULT '',
        goal int NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now())`);
      await p.query(`CREATE TABLE IF NOT EXISTS dreams (
        id text PRIMARY KEY,
        title text NOT NULL,
        category text NOT NULL DEFAULT 'Other',
        priority text NOT NULL DEFAULT 'medium',
        target_date date,
        budget text NOT NULL DEFAULT '',
        location text NOT NULL DEFAULT '',
        url text NOT NULL DEFAULT '',
        tags jsonb NOT NULL DEFAULT '[]',
        notes text NOT NULL DEFAULT '',
        memory text NOT NULL DEFAULT '',
        photo text NOT NULL DEFAULT '',
        emoji text NOT NULL DEFAULT '',
        steps jsonb NOT NULL DEFAULT '[]',
        pinned boolean NOT NULL DEFAULT false,
        done boolean NOT NULL DEFAULT false,
        rating smallint,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now())`);
      // Columns added in later versions, for databases created before them.
      await p.query("ALTER TABLE dreams ADD COLUMN IF NOT EXISTS emoji text NOT NULL DEFAULT ''");
      await p.query("ALTER TABLE dreams ADD COLUMN IF NOT EXISTS rating smallint");
      await p.query("ALTER TABLE profile ADD COLUMN IF NOT EXISTS goal int NOT NULL DEFAULT 0");
      await p.query("CREATE INDEX IF NOT EXISTS dreams_done_idx ON dreams (done, completed_at)");
      await p.query(`CREATE TABLE IF NOT EXISTS activity (
        id bigserial PRIMARY KEY,
        dream_id text,
        title text NOT NULL DEFAULT '',
        kind text NOT NULL,
        happened_at timestamptz NOT NULL DEFAULT now())`);
      await p.query(`CREATE TABLE IF NOT EXISTS pin_attempts (
        ip text PRIMARY KEY,
        fails int NOT NULL DEFAULT 0,
        last timestamptz NOT NULL DEFAULT now())`);
      await p.query(`CREATE TABLE IF NOT EXISTS bucketlist (
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now())`);
      await p.query("INSERT INTO profile (id) VALUES (1) ON CONFLICT (id) DO NOTHING");

      // One-time move: if the dreams table is empty but the old single-document row exists, copy it across.
      const { rows: [{ n }] } = await p.query("SELECT count(*)::int AS n FROM dreams");
      if (n === 0) {
        const legacy = await p.query("SELECT data FROM bucketlist WHERE id = 'main'");
        if (legacy.rows[0]?.data) await importState(p, legacy.rows[0].data);
      }
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
