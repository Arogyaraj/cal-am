import { withAuth } from "../lib/api.js";
import { sanitize, getDream, insertDream, updateDream, logActivity } from "../lib/db.js";

const EDITABLE = ["title","category","priority","date","budget","location","url","tags","notes","memory",
  "photo","emoji","steps","pinned","done","rating"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

export default withAuth(async (req, res, p) => {
  const id = String(req.query.id || "").slice(0, 40);
  const body = req.body || {};

  if (req.method === "POST") {
    let d;
    if (body.duplicateOf) {
      const src = await getDream(p, String(body.duplicateOf).slice(0, 40));
      if (!src) return res.status(404).json({ error: "Original not found" });
      d = sanitize({
        ...src, id: undefined, title: src.title + " (copy)", done: false, completedAt: 0,
        pinned: false, memory: "", rating: null, added: 0,
        steps: src.steps.map((s) => ({ ...s, id: undefined, done: false }))
      });
    } else {
      d = sanitize(body);
    }
    await insertDream(p, d);
    await logActivity(p, d.id, d.title, "created");
    return res.status(201).json(await getDream(p, d.id));
  }

  if (!id) return res.status(400).json({ error: "Missing id" });
  const old = await getDream(p, id);
  if (!old) return res.status(404).json({ error: "Not found" });

  if (req.method === "PATCH") {
    const merged = sanitize({ ...old, ...pick(body, EDITABLE), id });
    const before = sanitize(old);
    const changed = EDITABLE.some((k) => JSON.stringify(before[k]) !== JSON.stringify(merged[k]));
    await updateDream(p, merged);
    if (changed) {
      const kind = merged.done && !old.done ? "completed"
        : !merged.done && old.done ? "reopened"
        : merged.memory && merged.memory !== old.memory ? "memory"
        : "updated";
      await logActivity(p, id, merged.title, kind);
    }
    return res.status(200).json(await getDream(p, id));
  }

  if (req.method === "DELETE") {
    await p.query("DELETE FROM dreams WHERE id = $1", [id]);
    await logActivity(p, id, old.title, "deleted");
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "POST, PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
});
