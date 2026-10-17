// ระบบล็อกอิน: รหัสผ่านแบบ PBKDF2-SHA256 + cookie session ที่เก็บใน D1
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { DAY_MS } from "../shared/time";
import type { Role } from "../shared/labels";
import type { AppEnv, Env, SessionUser } from "./env";
import { fail, now } from "./util";

const enc = new TextEncoder();
export const COOKIE = "mlog_sid";
const SESSION_DAYS = 30;
const RENEW_BEFORE_MS = 15 * DAY_MS;
/** PBKDF2 100,000 รอบ: ค่าที่ Cloudflare Workers รองรับแน่นอน (Workers บางรุ่นจำกัดไว้ที่ค่านี้) และใช้ CPU ราว 20 ms */
export const MAX_PBKDF2_ITERATIONS = 100_000;

const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const b64url = (u8: Uint8Array) => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function iterationsFor(env: Env): number {
  const n = Number(env.PBKDF2_ITERATIONS);
  return Number.isInteger(n) && n >= 10_000 && n <= MAX_PBKDF2_ITERATIONS ? n : MAX_PBKDF2_ITERATIONS;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${b64(salt)}$${b64(hash)}`;
}

export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, it, salt, hash] = stored.split("$");
  const iterations = Number(it);
  if (alg !== "pbkdf2_sha256" || !Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS) return false;
  return safeEqual(await pbkdf2(password, unb64(salt), iterations), unb64(hash));
}

/** ใช้เวลาเท่ากับการตรวจรหัสจริง เมื่อไม่พบผู้ใช้ (กันการเดาชื่อผู้ใช้จากเวลาตอบกลับ) */
export async function dummyVerify(password: string, env: Env): Promise<void> {
  await verifyPassword(password, `pbkdf2_sha256$${iterationsFor(env)}$${b64(new Uint8Array(16))}$${b64(new Uint8Array(32))}`);
}

export async function sha256hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** เปรียบเทียบข้อความลับแบบใช้เวลาคงที่ */
export async function safeEqualStr(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  return safeEqual(new Uint8Array(ha), new Uint8Array(hb));
}

const isHttps = (c: Context) => new URL(c.req.url).protocol === "https:";

function writeCookie(c: Context, token: string) {
  setCookie(c, COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttps(c),
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function clearCookie(c: Context) {
  deleteCookie(c, COOKIE, { path: "/", secure: isHttps(c) });
}

/** สร้าง session ใหม่: คืนคำสั่ง INSERT (ใส่ใน batch) และตั้ง cookie */
export async function newSession(c: Context<AppEnv>, userId: string): Promise<D1PreparedStatement> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const t = now();
  writeCookie(c, token);
  return c.env.DB.prepare(
    "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
  ).bind(await sha256hex(token), userId, t, t + SESSION_DAYS * DAY_MS, (c.req.header("user-agent") ?? "").slice(0, 200));
}

type SessionRow = {
  expires_at: number;
  id: string;
  username: string;
  display_name: string;
  role: Role;
  active: number;
  must_change_password: number;
};

/** อ่านผู้ใช้จาก cookie (null = ยังไม่ล็อกอิน / หมดอายุ) */
export async function loadUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE);
  if (!token || token.length > 100) return null;
  const tokenHash = await sha256hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.expires_at, u.id, u.username, u.display_name, u.role, u.active, u.must_change_password
     FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<SessionRow>();
  const t = now();
  if (!row || row.expires_at < t || !row.active) return null;
  if (row.expires_at - t < RENEW_BEFORE_MS) {
    // ต่ออายุอัตโนมัติเมื่อยังใช้งานอยู่
    await c.env.DB.prepare("UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?")
      .bind(t + SESSION_DAYS * DAY_MS, tokenHash)
      .run();
    writeCookie(c, token);
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: !!row.must_change_password,
    tokenHash,
  };
}

export const publicUser = (u: SessionUser) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  mustChangePassword: u.mustChangePassword,
});

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const u = await loadUser(c);
  if (!u) fail(401, "กรุณาเข้าสู่ระบบ", "unauthorized");
  if (u.mustChangePassword) fail(403, "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน", "must_change_password");
  c.set("user", u);
  await next();
};

export const requireRole =
  (check: (r: Role) => boolean): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (!check(c.get("user").role)) fail(403, "บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้", "forbidden");
    await next();
  };
