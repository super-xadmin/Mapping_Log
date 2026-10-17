// ประวัติการใช้งานทั้งระบบ (ผู้ดูแลระบบ)
import { Hono } from "hono";
import { can } from "../../shared/labels";
import type { AppEnv } from "../env";
import { requireRole, requireUser } from "../auth";
import { clampInt } from "../util";

type Row = {
  id: number; at: number; user_name: string | null; action: string; session_id: string | null;
  detail: string | null; title: string | null; work_date: string | null;
};

export const auditRoutes = new Hono<AppEnv>();
auditRoutes.use("*", requireUser, requireRole(can.admin));

auditRoutes.get("/", async (c) => {
  const before = clampInt(c.req.query("before"), 1, Number.MAX_SAFE_INTEGER, 0);
  const limit = clampInt(c.req.query("limit"), 1, 200, 100);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.at, a.user_name, a.action, a.session_id, a.detail, s.title, s.work_date
     FROM audit_log a LEFT JOIN mapping_sessions s ON s.id = a.session_id
     ${before ? "WHERE a.id < ?" : ""} ORDER BY a.id DESC LIMIT ?`,
  )
    .bind(...(before ? [before] : []), limit + 1)
    .all<Row>();
  return c.json({
    entries: results.slice(0, limit).map((r) => ({
      id: r.id,
      at: r.at,
      userName: r.user_name,
      action: r.action,
      sessionId: r.session_id,
      detail: r.detail ? JSON.parse(r.detail) : null,
      sessionTitle: r.title,
      workDate: r.work_date,
    })),
    hasMore: results.length > limit,
  });
});
