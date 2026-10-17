import { Hono } from "hono";
import { USERNAME_RE, can, isRole, passwordProblem, type Role } from "../../shared/labels";
import type { AppEnv } from "../env";
import { hashPassword, iterationsFor, requireRole, requireUser } from "../auth";
import { audit, fail, now, readJson, str, uid } from "../util";

type UserDb = {
  id: string; username: string; display_name: string; role: Role; active: number;
  must_change_password: number; locked_until: number | null; last_login_at: number | null; created_at: number;
};
const toUser = (r: UserDb) => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role,
  active: !!r.active,
  mustChangePassword: !!r.must_change_password,
  lockedUntil: r.locked_until && r.locked_until > now() ? r.locked_until : null,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at,
});
const COLS = "id, username, display_name, role, active, must_change_password, locked_until, last_login_at, created_at";

export const userRoutes = new Hono<AppEnv>();
userRoutes.use("*", requireUser, requireRole(can.admin));

userRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${COLS} FROM users ORDER BY active DESC, display_name`).all<UserDb>();
  return c.json(results.map(toUser));
});

userRoutes.post("/", async (c) => {
  const b = await readJson(c);
  const DB = c.env.DB;
  const username = str(b.username, 32);
  if (!username || !USERNAME_RE.test(username)) fail(400, "ชื่อผู้ใช้ต้องเป็น a-z, 0-9, . _ - ยาว 3–32 ตัว");
  const displayName = str(b.displayName, 100) ?? fail(400, "กรุณากรอกชื่อที่แสดง");
  if (!isRole(b.role)) fail(400, "สิทธิ์ไม่ถูกต้อง");
  const problem = passwordProblem(b.password, username);
  if (problem) fail(400, problem);
  if (await DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first()) fail(409, "ชื่อผู้ใช้นี้มีอยู่แล้ว");
  const id = uid();
  const hash = await hashPassword(b.password as string, iterationsFor(c.env));
  await DB.batch([
    // บัญชีใหม่ต้องเปลี่ยนรหัสผ่านตอนเข้าใช้ครั้งแรก
    DB.prepare(
      "INSERT INTO users (id, username, display_name, role, password_hash, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
    ).bind(id, username, displayName, b.role, hash, now()),
    audit(DB, c.get("user"), "user.create", null, { username, displayName, role: b.role }),
  ]);
  return c.json({ id });
});

userRoutes.patch("/:id", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const b = await readJson(c);
  const DB = c.env.DB;
  const target = await DB.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).bind(id).first<UserDb>();
  if (!target) fail(404, "ไม่พบผู้ใช้");

  const sets: string[] = [];
  const vals: unknown[] = [];
  const changes: Record<string, unknown> = {};
  const extra: D1PreparedStatement[] = [];

  if (b.displayName !== undefined) {
    const v = str(b.displayName, 100) ?? fail(400, "กรุณากรอกชื่อที่แสดง");
    sets.push("display_name = ?"); vals.push(v); changes.displayName = v;
  }
  const newRole = b.role !== undefined ? b.role : target.role;
  if (!isRole(newRole)) fail(400, "สิทธิ์ไม่ถูกต้อง");
  const newActive = b.active !== undefined ? !!b.active : !!target.active;
  if (id === me.id && (newRole !== target.role || !newActive)) fail(400, "เปลี่ยนสิทธิ์หรือปิดบัญชีของตัวเองไม่ได้");
  if (target.role === "admin" && target.active && (newRole !== "admin" || !newActive)) {
    const others = await DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").bind(id).first<number>("n");
    if (!others) fail(400, "ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน");
  }
  if (newRole !== target.role) { sets.push("role = ?"); vals.push(newRole); changes.role = newRole; }
  if (newActive !== !!target.active) {
    sets.push("active = ?"); vals.push(newActive ? 1 : 0); changes.active = newActive;
    if (!newActive) extra.push(DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(id));
  }
  if (b.password !== undefined) {
    const problem = passwordProblem(b.password, target.username);
    if (problem) fail(400, problem);
    sets.push("password_hash = ?", "must_change_password = 1", "failed_logins = 0", "locked_until = NULL");
    vals.push(await hashPassword(b.password as string, iterationsFor(c.env)));
    changes.passwordReset = true;
    extra.push(DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(id));
  }
  if (b.unlock) {
    sets.push("failed_logins = 0", "locked_until = NULL");
    changes.unlocked = true;
  }
  if (!sets.length) return c.json({ ok: true });
  await DB.batch([
    DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id),
    ...extra,
    audit(DB, me, "user.update", null, { username: target.username, ...changes }),
  ]);
  return c.json({ ok: true });
});
