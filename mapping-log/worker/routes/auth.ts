import { Hono } from "hono";
import { USERNAME_RE, passwordProblem } from "../../shared/labels";
import type { AppEnv } from "../env";
import {
  clearCookie, dummyVerify, hashPassword, iterationsFor, loadUser, newSession, publicUser, safeEqualStr, verifyPassword,
} from "../auth";
import { audit, fail, now, readJson, str, uid } from "../util";

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;

export const authRoutes = new Hono<AppEnv>();

/** สถานะการล็อกอิน + ระบบตั้งค่าแล้วหรือยัง */
authRoutes.get("/state", async (c) => {
  const count = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<number>("n")) ?? 0;
  const user = count ? await loadUser(c) : null;
  return c.json({ setupRequired: count === 0, setupKeyConfigured: !!c.env.SETUP_KEY, user: user && publicUser(user) });
});

/** สร้างผู้ดูแลระบบคนแรก (ใช้ได้ครั้งเดียว และต้องมี SETUP_KEY) */
authRoutes.post("/setup", async (c) => {
  const b = await readJson(c);
  if (!c.env.SETUP_KEY) fail(503, "ยังไม่ได้ตั้งค่า SETUP_KEY ใน Cloudflare (ดูวิธีใน README)", "no_setup_key");
  if (!(await safeEqualStr(String(b.setupKey ?? ""), c.env.SETUP_KEY))) fail(403, "Setup key ไม่ถูกต้อง");
  const username = str(b.username, 32);
  if (!username || !USERNAME_RE.test(username)) fail(400, "ชื่อผู้ใช้ต้องเป็น a-z, 0-9, . _ - ยาว 3–32 ตัว");
  const displayName = str(b.displayName, 100) ?? fail(400, "กรุณากรอกชื่อที่แสดง");
  const problem = passwordProblem(b.password, username);
  if (problem) fail(400, problem);

  const id = uid();
  const hash = await hashPassword(b.password as string, iterationsFor(c.env));
  const res = await c.env.DB.prepare(
    `INSERT INTO users (id, username, display_name, role, password_hash, created_at)
     SELECT ?, ?, ?, 'admin', ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
  )
    .bind(id, username, displayName, hash, now())
    .run();
  if (!res.meta.changes) fail(409, "ระบบถูกตั้งค่าไปแล้ว กรุณาเข้าสู่ระบบ");
  const user = { id, displayName };
  await c.env.DB.batch([await newSession(c, id), audit(c.env.DB, user, "auth.setup", null, { username })]);
  return c.json({ ok: true });
});

type LoginRow = {
  id: string; username: string; display_name: string; role: string; password_hash: string;
  active: number; must_change_password: number; failed_logins: number; locked_until: number | null;
};

authRoutes.post("/login", async (c) => {
  const b = await readJson(c);
  const username = typeof b.username === "string" ? b.username.trim().slice(0, 64) : "";
  const password = typeof b.password === "string" ? b.password.slice(0, 256) : "";
  if (!username || !password) fail(400, "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");
  const DB = c.env.DB;
  const u = await DB.prepare(
    `SELECT id, username, display_name, role, password_hash, active, must_change_password, failed_logins, locked_until
     FROM users WHERE username = ?`,
  )
    .bind(username)
    .first<LoginRow>();
  const t = now();
  if (u?.locked_until && u.locked_until > t) {
    const mins = Math.ceil((u.locked_until - t) / 60_000);
    fail(429, `บัญชีถูกล็อกชั่วคราวเพราะใส่รหัสผ่านผิดหลายครั้ง ลองใหม่ในอีก ${mins} นาที`, "locked");
  }
  let ok = false;
  if (u) ok = await verifyPassword(password, u.password_hash);
  else await dummyVerify(password, c.env);

  if (!u || !ok) {
    if (u && u.active) {
      const failed = u.failed_logins + 1;
      const lock = failed >= MAX_FAILED;
      await DB.batch([
        DB.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?").bind(lock ? 0 : failed, lock ? t + LOCK_MS : null, u.id),
        audit(DB, null, lock ? "auth.locked" : "auth.login_failed", null, { username: u.username }),
      ]);
      if (lock) fail(429, `ใส่รหัสผ่านผิด ${MAX_FAILED} ครั้ง บัญชีถูกล็อก 15 นาที`, "locked");
    }
    fail(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", "bad_credentials");
  }
  if (!u.active) fail(403, "บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ", "inactive");

  const user = { id: u.id, displayName: u.display_name };
  await DB.batch([
    DB.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?").bind(t, u.id),
    DB.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND expires_at < ?").bind(u.id, t),
    await newSession(c, u.id),
    audit(DB, user, "auth.login", null),
  ]);
  return c.json({
    user: { id: u.id, username: u.username, displayName: u.display_name, role: u.role, mustChangePassword: !!u.must_change_password },
  });
});

authRoutes.post("/logout", async (c) => {
  const u = await loadUser(c);
  if (u) await c.env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(u.tokenHash).run();
  clearCookie(c);
  return c.json({ ok: true });
});

/** เปลี่ยนรหัสผ่านของตัวเอง (ใช้ได้แม้ถูกบังคับให้เปลี่ยนรหัส) */
authRoutes.post("/password", async (c) => {
  const u = (await loadUser(c)) ?? fail(401, "กรุณาเข้าสู่ระบบ", "unauthorized");
  const b = await readJson(c);
  const DB = c.env.DB;
  const row = await DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(u.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(String(b.currentPassword ?? ""), row.password_hash))) fail(400, "รหัสผ่านปัจจุบันไม่ถูกต้อง");
  const problem = passwordProblem(b.newPassword, u.username);
  if (problem) fail(400, problem);
  if (b.newPassword === b.currentPassword) fail(400, "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม");
  const hash = await hashPassword(b.newPassword as string, iterationsFor(c.env));
  await DB.batch([
    DB.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").bind(hash, u.id),
    // ออกจากระบบทุกเครื่องยกเว้นเครื่องนี้
    DB.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?").bind(u.id, u.tokenHash),
    audit(DB, u, "auth.password_change", null),
  ]);
  return c.json({ ok: true });
});
