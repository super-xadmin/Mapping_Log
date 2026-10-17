// แก้ไข / ลบ Calibration (บันทึกประวัติค่าเดิม-ค่าใหม่ทุกครั้ง)
import { Hono } from "hono";
import { can, isCalKind, type CalKind } from "../../shared/labels";
import { resolveCalTimes } from "../../shared/time";
import type { AppEnv } from "../env";
import { requireRole, requireUser } from "../auth";
import { LOCKED_MSG, audit, fail, now, readJson, str } from "../util";

type CalRow = {
  id: string; session_id: string; seq: number; kind: CalKind; started_at: number | null; ended_at: number | null;
  note: string | null; work_date: string; qc_status: string;
};

export const calRoutes = new Hono<AppEnv>();
calRoutes.use("*", requireUser, requireRole(can.record));

async function loadCal(DB: D1Database, id: string): Promise<CalRow> {
  const cal = await DB.prepare(
    `SELECT c.id, c.session_id, c.seq, c.kind, c.started_at, c.ended_at, c.note, s.work_date, s.qc_status
     FROM calibrations c JOIN mapping_sessions s ON s.id = c.session_id WHERE c.id = ?`,
  )
    .bind(id)
    .first<CalRow>();
  if (!cal) fail(404, "ไม่พบรายการ Calibration");
  if (cal.qc_status === "PASSED") fail(423, LOCKED_MSG, "locked");
  return cal;
}

const snapshot = (k: CalKind, s: number | null, e: number | null, n: string | null) => ({ kind: k, startedAt: s, endedAt: e, note: n });

calRoutes.patch("/:id", async (c) => {
  const DB = c.env.DB;
  const cal = await loadCal(DB, c.req.param("id"));
  const b = await readJson(c);
  if (!isCalKind(b.kind)) fail(400, "ประเภท Calibration ไม่ถูกต้อง");
  const r = resolveCalTimes(cal.work_date, String(b.start ?? ""), b.end ? String(b.end) : null, !!b.startNextDay);
  if (!r.ok) fail(400, r.error);
  const note = str(b.note, 500);
  await DB.batch([
    DB.prepare("UPDATE calibrations SET kind = ?, started_at = ?, ended_at = ?, note = ?, updated_at = ? WHERE id = ?").bind(
      b.kind, r.startedAt, r.endedAt, note, now(), cal.id,
    ),
    audit(DB, c.get("user"), "cal.update", cal.session_id, {
      seq: cal.seq,
      before: snapshot(cal.kind, cal.started_at, cal.ended_at, cal.note),
      after: snapshot(b.kind, r.startedAt, r.endedAt, note),
    }),
  ]);
  return c.json({ ok: true });
});

calRoutes.delete("/:id", async (c) => {
  const DB = c.env.DB;
  const cal = await loadCal(DB, c.req.param("id"));
  await DB.batch([
    DB.prepare("DELETE FROM calibrations WHERE id = ?").bind(cal.id),
    audit(DB, c.get("user"), "cal.delete", cal.session_id, {
      seq: cal.seq,
      before: snapshot(cal.kind, cal.started_at, cal.ended_at, cal.note),
    }),
  ]);
  return c.json({ ok: true });
});
