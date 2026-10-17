// รับข้อมูลจากเครื่องภาคสนามแบบออฟไลน์ได้: เริ่ม/จบรอบ, พิกัด GPS, เริ่ม/เสร็จ Calibration
// ทุกรายการส่งซ้ำได้โดยไม่เกิดข้อมูลซ้ำ (idempotent) และทำงานใน transaction เดียว
import { Hono } from "hono";
import { haversine } from "../../shared/geo";
import { can, isCalKind } from "../../shared/labels";
import { DAY_MS } from "../../shared/time";
import { CHUNK_MAX_POINTS, SYNC_MAX_OPS, type PtArr, type SyncResult } from "../../shared/types";
import type { AppEnv } from "../env";
import { requireRole, requireUser } from "../auth";
import { LOCKED_MSG, audit, fail, isUuid, now, qs, readJson, str } from "../util";

type RoundState = {
  id: string; session_id: string; seq: number | null; topic: string;
  started_at: number | null; ended_at: number | null; last_t: number | null; last_lat: number | null; last_lng: number | null;
};
type SessState = { id: string; qc_status: string; split_rounds: number };
type CalState = { id: string; session_id: string; seq: number | null; kind: string; started_at: number | null; ended_at: number | null };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inRange = (v: unknown, min: number, max: number) => (isNum(v) && v >= min && v <= max ? v : null);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

/** ตรวจและปัดค่าพิกัด (lat/lng 6 ตำแหน่ง ≈ 11 ซม.) เรียงตามเวลา */
function cleanPoints(raw: unknown): PtArr[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > CHUNK_MAX_POINTS) return null;
  const out: PtArr[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 3) return null;
    const [dt, lat, lng, acc, spd, hdg, alt] = p;
    if (!isNum(dt) || dt < 0 || dt > DAY_MS || !isNum(lat) || !isNum(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const h = inRange(hdg, 0, 360);
    out.push([
      Math.round(dt), r6(lat), r6(lng),
      r1(inRange(acc, 0, 100_000)), r1(inRange(spd, 0, 200)), h == null ? null : Math.round(h), r1(inRange(alt, -1000, 10_000)),
    ]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export const syncRoutes = new Hono<AppEnv>();
syncRoutes.use("*", requireUser, requireRole(can.record));

syncRoutes.post("/", async (c) => {
  const b = await readJson(c);
  if (!Array.isArray(b.ops)) fail(400, "ข้อมูลไม่ถูกต้อง");
  const ops = (b.ops as Record<string, unknown>[]).slice(0, SYNC_MAX_OPS).filter((o) => o && typeof o === "object");
  const DB = c.env.DB;
  const user = c.get("user");
  const t = now();
  const minT = t - 60 * DAY_MS;
  const maxT = t + 10 * 60_000; // เผื่อนาฬิกาเครื่องเร็วเล็กน้อย
  const okT = (v: unknown): v is number => isNum(v) && v >= minT && v <= maxT;

  // ดึงสถานะปัจจุบันของรอบ/งาน/Calibration ที่เกี่ยวข้องในครั้งเดียว
  const roundIds = new Set<string>(), sessIds = new Set<string>(), calIds = new Set<string>();
  for (const op of ops) {
    if (isUuid(op.roundId)) roundIds.add(op.roundId);
    if (isUuid(op.sessionId)) sessIds.add(op.sessionId);
    if (isUuid(op.calId)) calIds.add(op.calId);
  }
  const none = () => DB.prepare("SELECT NULL WHERE 0");
  const [rRes, sRes, cRes] = await DB.batch<Record<string, unknown>>([
    roundIds.size
      ? DB.prepare(`SELECT id, session_id, seq, topic, started_at, ended_at, last_t, last_lat, last_lng FROM rounds WHERE id IN (${qs(roundIds.size)})`).bind(...roundIds)
      : none(),
    sessIds.size ? DB.prepare(`SELECT id, qc_status, split_rounds FROM mapping_sessions WHERE id IN (${qs(sessIds.size)})`).bind(...sessIds) : none(),
    calIds.size
      ? DB.prepare(`SELECT id, session_id, seq, kind, started_at, ended_at FROM calibrations WHERE id IN (${qs(calIds.size)})`).bind(...calIds)
      : none(),
  ]);
  const rounds = new Map((rRes.results as RoundState[]).map((r) => [r.id, r]));
  const sessions = new Map((sRes.results as SessState[]).map((s) => [s.id, s]));
  const cals = new Map((cRes.results as CalState[]).map((x) => [x.id, x]));

  const stmts: D1PreparedStatement[] = [];
  const results: SyncResult[] = [];
  const sessErr = (sid: string): string | null => {
    const s = sessions.get(sid);
    if (!s) return "ไม่พบงานนี้ (อาจถูกลบไปแล้ว)";
    if (s.qc_status === "PASSED") return LOCKED_MSG;
    return null;
  };

  for (const op of ops) {
    const id = typeof op.id === "string" ? op.id.slice(0, 64) : "";
    if (!id) continue;
    const done = (error?: string | null) => results.push(error ? { id, ok: false, error } : { id, ok: true });
    const sid = isUuid(op.sessionId) ? op.sessionId : "";

    switch (op.k) {
      case "round.add": {
        const topic = str(op.topic, 200);
        if (!isUuid(op.roundId) || !topic) { done("ข้อมูลรอบไม่ถูกต้อง"); break; }
        const e = sessErr(sid);
        if (e) { done(e); break; }
        if (!sessions.get(sid)!.split_rounds) { done("งานนี้ไม่ได้แบ่งรอบ"); break; }
        const existing = rounds.get(op.roundId);
        if (existing) { done(existing.session_id === sid ? null : "รหัสรอบซ้ำ"); break; }
        stmts.push(
          DB.prepare("INSERT OR IGNORE INTO rounds (id, session_id, seq, topic) SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ? FROM rounds WHERE session_id = ?")
            .bind(op.roundId, sid, topic, sid),
          audit(DB, user, "round.add", sid, { topic }),
        );
        rounds.set(op.roundId, {
          id: op.roundId, session_id: sid, seq: null, topic, started_at: null, ended_at: null, last_t: null, last_lat: null, last_lng: null,
        });
        done();
        break;
      }

      case "round.start":
      case "round.end":
      case "chunk": {
        const r = isUuid(op.roundId) ? rounds.get(op.roundId) : undefined;
        if (!r || r.session_id !== sid) { done("ไม่พบรอบนี้"); break; }
        const e = sessErr(sid);
        if (e) { done(e); break; }

        if (op.k === "round.start") {
          if (!okT(op.t)) { done("เวลาไม่ถูกต้อง"); break; }
          if (r.started_at == null) {
            stmts.push(
              DB.prepare("UPDATE rounds SET started_at = ?, started_by = ? WHERE id = ? AND started_at IS NULL").bind(op.t, user.id, r.id),
              audit(DB, user, "round.start", sid, { seq: r.seq, topic: r.topic, t: op.t }),
            );
            r.started_at = op.t;
          }
          done();
          break;
        }

        if (op.k === "round.end") {
          if (!okT(op.t)) { done("เวลาไม่ถูกต้อง"); break; }
          if (r.started_at == null) { done("รอบนี้ยังไม่ได้เริ่ม"); break; }
          if (r.ended_at == null) {
            const endT = Math.max(op.t, r.started_at);
            stmts.push(
              DB.prepare("UPDATE rounds SET ended_at = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL").bind(endT, user.id, r.id),
              audit(DB, user, "round.end", sid, { seq: r.seq, topic: r.topic, t: endT }),
            );
            r.ended_at = endT;
          }
          done();
          break;
        }

        // chunk: ก้อนพิกัด GPS
        if (!okT(op.t0)) { done("เวลาไม่ถูกต้อง"); break; }
        const pts = cleanPoints(op.pts);
        if (!pts) { done("ข้อมูลพิกัดไม่ถูกต้อง"); break; }
        const t0 = op.t0;
        let dist = 0;
        for (let i = 1; i < pts.length; i++) dist += haversine(pts[i - 1][1], pts[i - 1][2], pts[i][1], pts[i][2]);
        if (r.last_t != null && r.last_lat != null && r.last_lng != null && t0 > r.last_t)
          dist += haversine(r.last_lat, r.last_lng, pts[0][1], pts[0][2]);
        const last = pts[pts.length - 1];
        const tEnd = t0 + last[0];
        stmts.push(
          // สรุปจำนวนจุด/ระยะทางของรอบ (บวกเพิ่มเฉพาะก้อนที่ยังไม่เคยบันทึก)
          DB.prepare(
            `UPDATE rounds SET point_count = point_count + ?1, distance_m = distance_m + ?2,
               last_lat = CASE WHEN last_t IS NULL OR ?3 > last_t THEN ?4 ELSE last_lat END,
               last_lng = CASE WHEN last_t IS NULL OR ?3 > last_t THEN ?5 ELSE last_lng END,
               last_t   = CASE WHEN last_t IS NULL OR ?3 > last_t THEN ?3 ELSE last_t END
             WHERE id = ?6 AND NOT EXISTS (SELECT 1 FROM track_chunks WHERE round_id = ?6 AND t_start = ?7)`,
          ).bind(pts.length, dist, tEnd, last[1], last[2], r.id, t0),
          DB.prepare("INSERT OR IGNORE INTO track_chunks (round_id, t_start, t_end, n, pts) VALUES (?, ?, ?, ?, ?)").bind(
            r.id, t0, tEnd, pts.length, JSON.stringify(pts),
          ),
        );
        if (r.last_t == null || tEnd > r.last_t) {
          r.last_t = tEnd;
          r.last_lat = last[1];
          r.last_lng = last[2];
        }
        done();
        break;
      }

      case "cal.start": {
        if (!isUuid(op.calId) || !isCalKind(op.kind) || !okT(op.t)) { done("ข้อมูล Calibration ไม่ถูกต้อง"); break; }
        const e = sessErr(sid);
        if (e) { done(e); break; }
        const existing = cals.get(op.calId);
        if (existing) { done(existing.session_id === sid ? null : "รหัส Calibration ซ้ำ"); break; }
        stmts.push(
          DB.prepare(
            `INSERT OR IGNORE INTO calibrations (id, session_id, seq, kind, started_at, created_by, created_at)
             SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ? FROM calibrations WHERE session_id = ?`,
          ).bind(op.calId, sid, op.kind, op.t, user.id, t, sid),
          audit(DB, user, "cal.start", sid, { kind: op.kind, t: op.t }),
        );
        cals.set(op.calId, { id: op.calId, session_id: sid, seq: null, kind: op.kind, started_at: op.t, ended_at: null });
        done();
        break;
      }

      case "cal.end": {
        const cal = isUuid(op.calId) ? cals.get(op.calId) : undefined;
        if (!cal || cal.session_id !== sid) { done("ไม่พบรายการ Calibration"); break; }
        if (!okT(op.t)) { done("เวลาไม่ถูกต้อง"); break; }
        const e = sessErr(sid);
        if (e) { done(e); break; }
        if (cal.ended_at == null) {
          const endT = Math.max(op.t, cal.started_at ?? op.t);
          stmts.push(
            DB.prepare("UPDATE calibrations SET ended_at = ? WHERE id = ? AND ended_at IS NULL").bind(endT, cal.id),
            audit(DB, user, "cal.end", sid, { kind: cal.kind, seq: cal.seq, t: endT }),
          );
          cal.ended_at = endT;
        }
        done();
        break;
      }

      default:
        done("ไม่รู้จักรายการนี้");
    }
  }

  if (stmts.length) {
    try {
      await DB.batch(stmts);
    } catch (err) {
      console.error("sync batch failed", err);
      fail(503, "บันทึกข้อมูลไม่สำเร็จ ระบบจะลองส่งใหม่อัตโนมัติ", "retry");
    }
  }
  return c.json({ results });
});
