import { withAuth } from "../lib/api.js";

export default withAuth(async (req, res, p) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const [totals, monthly, byCategory, byPriority] = await Promise.all([
    p.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE done)::int AS done,
        count(*) FILTER (WHERE done AND date_part('year', completed_at) = date_part('year', now()))::int AS "doneYear",
        count(*) FILTER (WHERE NOT done AND target_date < current_date)::int AS overdue,
        round(avg(extract(epoch FROM (completed_at - created_at)) / 86400.0) FILTER (WHERE done AND completed_at IS NOT NULL))::int AS "avgDays",
        avg(rating)::float8 AS "avgRating"
      FROM dreams`),
    p.query(`SELECT to_char(date_trunc('month', completed_at), 'YYYY-MM') AS month, count(*)::int AS n
      FROM dreams WHERE done AND completed_at >= date_trunc('month', now()) - interval '11 months'
      GROUP BY 1 ORDER BY 1`),
    p.query(`SELECT category, count(*)::int AS total, count(*) FILTER (WHERE done)::int AS done
      FROM dreams GROUP BY category ORDER BY total DESC`),
    p.query(`SELECT priority, count(*)::int AS total, count(*) FILTER (WHERE done)::int AS done
      FROM dreams GROUP BY priority`)
  ]);
  return res.status(200).json({
    ...totals.rows[0],
    monthly: monthly.rows,
    byCategory: byCategory.rows,
    byPriority: byPriority.rows
  });
});
