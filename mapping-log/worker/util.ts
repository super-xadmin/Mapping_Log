import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const now = () => Date.now();
export const uid = () => crypto.randomUUID();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** หยุดการทำงานและตอบกลับเป็น JSON { error, code, ...extra } */
export function fail(status: ContentfulStatusCode, message: string, code?: string, extra?: Record<string, unknown>): never {
  throw new HTTPException(status, {
    res: Response.json({ error: message, code, ...extra }, { status }),
  });
}

export async function readJson(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    fail(400, "ข้อมูลที่ส่งมาไม่ถูกต้อง");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "ข้อมูลที่ส่งมาไม่ถูกต้อง");
  return body as Record<string, unknown>;
}

/** ข้อความที่ตัดช่องว่างแล้ว (ว่าง = null) */
export function str(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export const qs = (n: number) => Array(n).fill("?").join(",");

export const LOCKED_MSG = "งานนี้ผ่าน QC แล้ว ข้อมูลถูกล็อก (ให้ผู้ตรวจ QC เปลี่ยนสถานะก่อนจึงจะแก้ไขได้)";
export const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : dflt;
};

/** คำสั่งบันทึกประวัติการใช้งาน (ใส่ใน batch เดียวกับการแก้ข้อมูล) */
export function audit(
  db: D1Database,
  user: { id: string; displayName: string } | null,
  action: string,
  sessionId: string | null,
  detail?: Record<string, unknown>,
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO audit_log (at, user_id, user_name, action, session_id, detail) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(now(), user?.id ?? null, user?.displayName ?? null, action, sessionId, detail ? JSON.stringify(detail) : null);
}
