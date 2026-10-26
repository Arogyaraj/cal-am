import { withAuth } from "../lib/api.js";
import { importState } from "../lib/db.js";

export default withAuth(async (req, res, p) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const data = req.body;
  if (!data || !Array.isArray(data.items)) return res.status(400).json({ error: "Not a valid backup" });
  const count = await importState(p, data);
  return res.status(200).json({ ok: true, count });
});
