import { withAuth } from "../lib/api.js";
import { getProfile, listDreams, listActivity, saveProfile, tx } from "../lib/db.js";

export default withAuth(async (req, res, p) => {
  if (req.method === "GET") {
    const [profile, dreams, activity] = await Promise.all([getProfile(p), listDreams(p), listActivity(p)]);
    return res.status(200).json({ profile, dreams, activity });
  }
  if (req.method === "PUT") {
    await saveProfile(p, req.body || {});
    return res.status(200).json(await getProfile(p));
  }
  if (req.method === "DELETE") {
    await tx(p, async (c) => {
      await c.query("DELETE FROM dreams");
      await c.query("DELETE FROM activity");
      await c.query("DELETE FROM bucketlist");
      await c.query("UPDATE profile SET name = 'Your Name', tagline = '', photo = '', goal = 0, updated_at = now() WHERE id = 1");
    });
    return res.status(200).json({ ok: true });
  }
  res.setHeader("Allow", "GET, PUT, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
});
