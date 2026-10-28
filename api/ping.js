import { withAuth } from "../lib/api.js";

export default withAuth(async (req, res) => {
  return res.status(200).json({ ok: true });
});
