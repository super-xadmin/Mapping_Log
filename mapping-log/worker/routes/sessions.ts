// งาน Mapping: รายการ/ค้นหา, สร้าง, รายละเอียด, แก้ไข, ลบ, QC, พิกัด, ประวัติ, เพิ่ม Calibration
import { Hono } from "hono";
import { can, isCalKind, isQc } from "../../shared/labels";
import { isDateStr, resolveCalTimes, resolvePlannedRounds } from "../../shared/time";
import { calComplete } from "../../shared/types";
import type { AppEnv } from "../env";
import { requireRole, requireUser } from "../auth";
import { CAL_SELECT, ROUND_SELECT, SESSION_SELECT, toSession, type CalDb, type RoundDb, type SessionDb } from "../rows";
import { LOCKED_MSG, audit, clampInt, fail, isUuid, now, readJson, str, uid } from "../util";

export const sessionRoutes = new Hono<AppEnv>();
sessionRoutes.use("*", requireUser);

const ORDER = "ORDER BY s.work_date DESC, s.created_at DESC";
const MAX_ROUNDS = 20;

async function loadSession(DB: D1Database, id: string) {
  const [s, r, c] = await DB.batch<Record<string, unknown>>([
    DB.prepare(`${SESSION_SELECT} WHERE s.id = ?`).bind(id),
    DB.prepare(`${ROUND_SELECT} WHERE r.session_id = ? ORDER BY r.seq`).bind(id),
    DB.prepare(`${CAL_SELECT} WHERE c.session_id = ? ORDER BY c.seq`).bind(id),
  ]);
  const row = s.results[0] as SessionDb | undefined;
  if (!row) fail(404, "ไม่พบงานนี้ (อาจถูกลบไปแล้ว)");
  return toSession(row, r.results as RoundDb[], c.results as CalDb[]);
}

/** ตรวจว่าคนขับ/รถ/โปรเจกต์มีอยู่และยังใช้งาน */
async function checkRefs(DB: D1Database, driverId: string, vehicleId: string, projectId: string) {
  const chk = await DB.prepare(
    `SELECT (SELECT active FROM drivers WHERE id = ?) AS d, (SELECT active FROM vehicles WHERE id = ?) AS v,
            (SELECT active FROM projects WHERE id = ?) AS p`,
  )
    .bind(driverId, vehicleId, projectId)
    .first<{ d: number | null; v: number | null; p: number | null }>();
  if (!chk?.d) fail(400, "ไม่พบคนขับนี้ หรือถูกปิดใช้งานแล้ว");
  if (!chk.v) fail(400, "ไม่พบรถคันนี้ หรือถูกปิดใช้งานแล้ว");
  if (!chk.p) fail(400, "ไม่พบโปรเจกต์นี้ หรือถูกปิดใช้งานแล้ว");
}

// ---------- รายการงาน + ตัวกรอง ----------
sessionRoutes.get("/", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const params: unknown[] = [];
  if (isDateStr(q.from)) { where.push("s.work_date >= ?"); params.push(q.from); }
  if (isDateStr(q.to)) { where.push("s.work_date <= ?"); params.push(q.to); }
  if (isUuid(q.driverId)) { where.push("s.driver_id = ?"); params.push(q.driverId); }
  if (isUuid(q.vehicleId)) { where.push("s.vehicle_id = ?"); params.push(q.vehicleId); }
  if (isUuid(q.projectId)) { where.push("s.project_id = ?"); params.push(q.projectId); }
  if (isQc(q.qc)) { where.push("s.qc_status = ?"); params.push(q.qc); }
  const calOk = "EXISTS (SELECT 1 FROM calibrations c2 WHERE c2.session_id = s.id AND c2.started_at IS NOT NULL AND c2.ended_at IS NOT NULL)";
  if (q.cal === "missing") where.push(`NOT ${calOk}`);
  else if (q.cal === "ok") where.push(calOk);
  const term = str(q.q, 100);
  if (term) {
    // ใช้ instr แทน LIKE เพราะ D1 จำกัดความยาว pattern ของ LIKE ไว้ 50 ไบต์ (ภาษาไทย 1 ตัว = 3 ไบต์)
    where.push(`(instr(lower(s.title), lower(?)) > 0 OR instr(lower(coalesce(s.notes, '')), lower(?)) > 0
      OR EXISTS (SELECT 1 FROM rounds r2 WHERE r2.session_id = s.id AND instr(lower(r2.topic), lower(?)) > 0))`);
    params.push(term, term, term);
  }
  const limit = clampInt(q.limit, 1, 100, 50);
  const offset = clampInt(q.offset, 0, 1_000_000, 0);
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const ids = `SELECT s.id FROM mapping_sessions s ${w} ${ORDER} LIMIT ? OFFSET ?`;
  const DB = c.env.DB;
  const [sRes, rRes, cRes] = await DB.batch<Record<string, unknown>>([
    DB.prepare(`${SESSION_SELECT} ${w} ${ORDER} LIMIT ? OFFSET ?`).bind(...params, limit + 1, offset),
    DB.prepare(`${ROUND_SELECT} WHERE r.session_id IN (${ids}) ORDER BY r.seq`).bind(...params, limit + 1, offset),
    DB.prepare(`${CAL_SELECT} WHERE c.session_id IN (${ids}) ORDER BY c.seq`).bind(...params, limit + 1, offset),
  ]);
  const rows = sRes.results as SessionDb[];
  const rounds = rRes.results as RoundDb[];
  const cals = cRes.results as CalDb[];
  return c.json({
    sessions: rows.slice(0, limit).map((s) => toSession(s, rounds, cals)),
    hasMore: rows.length > limit,
  });
});

// ---------- สร้างงาน ----------
sessionRoutes.post("/", requireRole(can.record), async (c) => {
  const b = await readJson(c);
  const DB = c.env.DB;
  const user = c.get("user");
  const title = str(b.title, 200) ?? fail(400, "กรุณากรอกชื่องาน");
  if (!isDateStr(b.workDate)) fail(400, "วันที่ไม่ถูกต้อง");
  const workDate = b.workDate;
  const driverId = str(b.driverId, 64), vehicleId = str(b.vehicleId, 64), projectId = str(b.projectId, 64);
  if (!driverId || !vehicleId || !projectId) fail(400, "กรุณาเลือกคนขับ รถ และโปรเจกต์");
  await checkRefs(DB, driverId, vehicleId, projectId);

  const split = !!b.splitRounds;
  let rounds: { topic: string; ps: number | null; pe: number | null }[];
  if (split) {
    const raw = Array.isArray(b.rounds) ? (b.rounds as Record<string, unknown>[]) : [];
    if (raw.length > MAX_ROUNDS) fail(400, `แบ่งได้สูงสุด ${MAX_ROUNDS} รอบ`);
    const input = raw.map((r) => ({
      topic: String(r?.topic ?? "").trim().slice(0, 200),
      plannedStart: String(r?.plannedStart ?? ""),
      plannedEnd: String(r?.plannedEnd ?? ""),
    }));
    const res = resolvePlannedRounds(workDate, input);
    if (!res.ok) fail(400, res.error);
    rounds = input.map((r, i) => ({ topic: r.topic, ps: res.times[i][0], pe: res.times[i][1] }));
  } else {
    rounds = [{ topic: title, ps: null, pe: null }];
  }

  const id = uid();
  await DB.batch([
    DB.prepare(
      `INSERT INTO mapping_sessions (id, title, work_date, split_rounds, notes, driver_id, vehicle_id, project_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, title, workDate, split ? 1 : 0, str(b.notes, 2000), driverId, vehicleId, projectId, user.id, now()),
    ...rounds.map((r, i) =>
      DB.prepare("INSERT INTO rounds (id, session_id, seq, topic, planned_start, planned_end) VALUES (?, ?, ?, ?, ?, ?)").bind(
        uid(), id, i + 1, r.topic, r.ps, r.pe,
      ),
    ),
    audit(DB, user, "session.create", id, { title, workDate, rounds: rounds.length, splitRounds: split }),
  ]);
  return c.json({ id });
});

// ---------- รายละเอียด ----------
sessionRoutes.get("/:id", async (c) => c.json(await loadSession(c.env.DB, c.req.param("id"))));

// ---------- แก้ไขข้อมูลงาน ----------
sessionRoutes.patch("/:id", requireRole(can.record), async (c) => {
  const id = c.req.param("id");
  const b = await readJson(c);
  const DB = c.env.DB;
  const s = await DB.prepare("SELECT title, notes, driver_id, vehicle_id, project_id, qc_status FROM mapping_sessions WHERE id = ?")
    .bind(id)
    .first<{ title: string; notes: string | null; driver_id: string; vehicle_id: string; project_id: string; qc_status: string }>();
  if (!s) fail(404, "ไม่พบงานนี้");
  if (s.qc_status === "PASSED") fail(423, LOCKED_MSG, "locked");
  const next = {
    title: b.title !== undefined ? str(b.title, 200) ?? fail(400, "กรุณากรอกชื่องาน") : s.title,
    notes: b.notes !== undefined ? str(b.notes, 2000) : s.notes,
    driver_id: b.driverId !== undefined ? String(b.driverId) : s.driver_id,
    vehicle_id: b.vehicleId !== undefined ? String(b.vehicleId) : s.vehicle_id,
    project_id: b.projectId !== undefined ? String(b.projectId) : s.project_id,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== s[k]);
  if (!changed.length) return c.json({ ok: true });
  if (changed.some((k) => k.endsWith("_id"))) await checkRefs(DB, next.driver_id, next.vehicle_id, next.project_id);
  await DB.batch([
    DB.prepare("UPDATE mapping_sessions SET title = ?, notes = ?, driver_id = ?, vehicle_id = ?, project_id = ? WHERE id = ?").bind(
      next.title, next.notes, next.driver_id, next.vehicle_id, next.project_id, id,
    ),
    audit(DB, c.get("user"), "session.update", id, {
      changes: Object.fromEntries(changed.map((k) => [k, { from: s[k], to: next[k] }])),
    }),
  ]);
  return c.json({ ok: true });
});

// ---------- ลบงาน (ผู้ดูแลระบบเท่านั้น) ----------
sessionRoutes.delete("/:id", requireRole(can.admin), async (c) => {
  const id = c.req.param("id");
  const DB = c.env.DB;
  const s = await DB.prepare("SELECT title, work_date FROM mapping_sessions WHERE id = ?").bind(id).first<{ title: string; work_date: string }>();
  if (!s) fail(404, "ไม่พบงานนี้");
  await DB.batch([
    audit(DB, c.get("user"), "session.delete", id, { title: s.title, workDate: s.work_date }),
    DB.prepare("DELETE FROM track_chunks WHERE round_id IN (SELECT id FROM rounds WHERE session_id = ?)").bind(id),
    DB.prepare("DELETE FROM rounds WHERE session_id = ?").bind(id),
    DB.prepare("DELETE FROM calibrations WHERE session_id = ?").bind(id),
    DB.prepare("DELETE FROM mapping_sessions WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

// ---------- สถานะ QC ----------
sessionRoutes.patch("/:id/qc", requireRole(can.qc), async (c) => {
  const id = c.req.param("id");
  const b = await readJson(c);
  if (!isQc(b.status)) fail(400, "สถานะไม่ถูกต้อง");
  const note = str(b.note, 1000);
  const DB = c.env.DB;
  const s = await loadSession(DB, id);
  if (b.status === "PASSED") {
    const problems: string[] = [];
    if (!calComplete(s.calibrations)) problems.push("ยังไม่มีข้อมูล Calibration ที่มีทั้งเวลาเริ่มและเวลาเสร็จ");
    if (s.rounds.some((r) => r.startedAt != null && r.endedAt == null)) problems.push("ยังมีรอบที่กำลังวิ่งอยู่ (ยังไม่ได้กดจบรอบ)");
    if (!s.rounds.some((r) => r.endedAt != null)) problems.push("ยังไม่มีรอบที่วิ่งเสร็จ");
    if (problems.length) fail(400, `ยังให้ผ่าน QC ไม่ได้: ${problems.join(" / ")}`, "qc_blocked", { problems });
  }
  const user = c.get("user");
  await DB.batch([
    DB.prepare("UPDATE mapping_sessions SET qc_status = ?, qc_note = ?, qc_by = ?, qc_at = ? WHERE id = ?").bind(b.status, note, user.id, now(), id),
    audit(DB, user, "qc.update", id, { from: s.qcStatus, to: b.status, note }),
  ]);
  return c.json({ ok: true });
});

// ---------- พิกัด GPS ทั้งหมดของงาน ----------
// ส่งกลับเป็น {"rounds":{"<roundId>":[[t0,[[dt,lat,lng,acc,spd,hdg,alt],...]],...]}}
// ต่อข้อความ JSON ที่เก็บไว้ตรง ๆ โดยไม่ parse ใหม่ เพื่อประหยัด CPU ของ Worker
sessionRoutes.get("/:id/track", async (c) => {
  const id = c.req.param("id");
  const round = c.req.query("round");
  const DB = c.env.DB;
  const base = "SELECT tc.round_id, tc.t_start, tc.pts FROM track_chunks tc JOIN rounds r ON r.id = tc.round_id WHERE r.session_id = ?";
  const stmt = isUuid(round)
    ? DB.prepare(`${base} AND tc.round_id = ? ORDER BY tc.t_start`).bind(id, round)
    : DB.prepare(`${base} ORDER BY tc.round_id, tc.t_start`).bind(id);
  const rows = await stmt.raw<[string, number, string]>();
  let out = '{"rounds":{';
  let cur: string | null = null;
  let firstChunk = true;
  for (const [rid, t0, pts] of rows) {
    if (rid !== cur) {
      if (cur !== null) out += "],";
      out += `${JSON.stringify(rid)}:[`;
      cur = rid;
      firstChunk = true;
    }
    out += `${firstChunk ? "" : ","}[${t0},${pts}]`;
    firstChunk = false;
  }
  if (cur !== null) out += "]";
  out += "}}";
  return c.body(out, 200, { "Content-Type": "application/json; charset=utf-8" });
});

// ---------- ประวัติการทำงานของงานนี้ (timeline) ----------
sessionRoutes.get("/:id/audit", async (c) => {
  const id = c.req.param("id");
  const { results } = await c.env.DB.prepare(
    "SELECT id, at, user_name, action, detail FROM audit_log WHERE session_id = ? ORDER BY at, id LIMIT 1000",
  )
    .bind(id)
    .all<{ id: number; at: number; user_name: string | null; action: string; detail: string | null }>();
  return c.json(
    results.map((r) => ({
      id: r.id,
      at: r.at,
      userName: r.user_name,
      action: r.action,
      sessionId: id,
      detail: r.detail ? JSON.parse(r.detail) : null,
    })),
  );
});

// ---------- เพิ่ม Calibration แบบกรอกเวลาเอง ----------
sessionRoutes.post("/:id/calibrations", requireRole(can.record), async (c) => {
  const id = c.req.param("id");
  const b = await readJson(c);
  const DB = c.env.DB;
  const user = c.get("user");
  const s = await DB.prepare("SELECT work_date, qc_status FROM mapping_sessions WHERE id = ?").bind(id).first<{ work_date: string; qc_status: string }>();
  if (!s) fail(404, "ไม่พบงานนี้");
  if (s.qc_status === "PASSED") fail(423, LOCKED_MSG, "locked");
  if (!isCalKind(b.kind)) fail(400, "ประเภท Calibration ไม่ถูกต้อง");
  const r = resolveCalTimes(s.work_date, String(b.start ?? ""), b.end ? String(b.end) : null, !!b.startNextDay);
  if (!r.ok) fail(400, r.error);
  const note = str(b.note, 500);
  const calId = uid();
  await DB.batch([
    DB.prepare(
      `INSERT INTO calibrations (id, session_id, seq, kind, started_at, ended_at, note, created_by, created_at)
       SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?, ? FROM calibrations WHERE session_id = ?`,
    ).bind(calId, id, b.kind, r.startedAt, r.endedAt, note, user.id, now(), id),
    audit(DB, user, "cal.create", id, { kind: b.kind, startedAt: r.startedAt, endedAt: r.endedAt, note }),
  ]);
  return c.json({ id: calId });
});
