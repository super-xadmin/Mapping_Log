// Cloudflare Worker: API ของ Mapping Log (หน้าเว็บเป็นไฟล์ static ที่ Cloudflare ให้บริการเอง)
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./env";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";
import { masterRoutes } from "./routes/master";
import { sessionRoutes } from "./routes/sessions";
import { calRoutes } from "./routes/calibrations";
import { syncRoutes } from "./routes/sync";
import { auditRoutes } from "./routes/audit";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", async (c, next) => {
  // กัน CSRF: คำขอที่แก้ไขข้อมูลต้องมาจากเว็บไซต์เดียวกัน
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "คำขอไม่ได้มาจากเว็บไซต์นี้" }, 403);
  }
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

app.route("/auth", authRoutes);
app.route("/users", userRoutes);
app.route("/master", masterRoutes);
app.route("/sessions", sessionRoutes);
app.route("/calibrations", calRoutes);
app.route("/sync", syncRoutes);
app.route("/audit", auditRoutes);

app.notFound((c) => c.json({ error: "ไม่พบ API นี้" }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่" }, 500);
});

export default app;
