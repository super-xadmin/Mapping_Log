// ข้อมูลหลัก: คนขับ/ทีม, รถ/อุปกรณ์, โปรเจกต์/พื้นที่ (ปิดใช้งานแทนการลบ เพื่อให้ข้อมูลย้อนหลังครบ)
import { Hono } from "hono";
import { can } from "../../shared/labels";
import type { AppEnv } from "../env";
import { requireRole, requireUser } from "../auth";
import { audit, fail, now, readJson, str, uid } from "../util";

const TYPES = {
  drivers: { table: "drivers", main: "name", sub: "team", label: "คนขับ" },
  vehicles: { table: "vehicles", main: "plate", sub: "equipment", label: "รถ" },
  projects: { table: "projects", main: "name", sub: "area", label: "โปรเจกต์" },
} as const;
type TypeKey = keyof typeof TYPES;
const typeOf = (t: string) => (t in TYPES ? TYPES[t as TypeKey] : fail(404, "ไม่พบประเภทข้อมูล"));

export const masterRoutes = new Hono<AppEnv>();
masterRoutes.use("*", requireUser);

masterRoutes.get("/", async (c) => {
  const DB = c.env.DB;
  const [d, v, p] = await DB.batch<Record<string, unknown>>([
    DB.prepare("SELECT id, name, team, active FROM drivers ORDER BY active DESC, name"),
    DB.prepare("SELECT id, plate, equipment, active FROM vehicles ORDER BY active DESC, plate"),
    DB.prepare("SELECT id, name, area, active FROM projects ORDER BY active DESC, name"),
  ]);
  const fix = (rows: Record<string, unknown>[]) => rows.map((r) => ({ ...r, active: !!r.active }));
  return c.json({ drivers: fix(d.results), vehicles: fix(v.results), projects: fix(p.results) });
});

masterRoutes.post("/:type", requireRole(can.admin), async (c) => {
  const t = typeOf(c.req.param("type"));
  const b = await readJson(c);
  const main = str(b[t.main], 200) ?? fail(400, `กรุณากรอก${t.label}`);
  const sub = str(b[t.sub], 300);
  const id = uid();
  const DB = c.env.DB;
  await DB.batch([
    DB.prepare(`INSERT INTO ${t.table} (id, ${t.main}, ${t.sub}, created_at) VALUES (?, ?, ?, ?)`).bind(id, main, sub, now()),
    audit(DB, c.get("user"), "master.create", null, { type: t.label, name: main, detail: sub }),
  ]);
  return c.json({ id });
});

masterRoutes.patch("/:type/:id", requireRole(can.admin), async (c) => {
  const t = typeOf(c.req.param("type"));
  const id = c.req.param("id");
  const b = await readJson(c);
  const DB = c.env.DB;
  const row = await DB.prepare(`SELECT ${t.main} AS main FROM ${t.table} WHERE id = ?`).bind(id).first<{ main: string }>();
  if (!row) fail(404, "ไม่พบข้อมูล");
  const sets: string[] = [];
  const vals: unknown[] = [];
  const changes: Record<string, unknown> = {};
  if (b[t.main] !== undefined) {
    const v = str(b[t.main], 200) ?? fail(400, `กรุณากรอก${t.label}`);
    sets.push(`${t.main} = ?`); vals.push(v); changes.newName = v;
  }
  if (b[t.sub] !== undefined) { const v = str(b[t.sub], 300); sets.push(`${t.sub} = ?`); vals.push(v); changes.detail = v; }
  if (b.active !== undefined) { sets.push("active = ?"); vals.push(b.active ? 1 : 0); changes.active = !!b.active; }
  if (!sets.length) return c.json({ ok: true });
  await DB.batch([
    DB.prepare(`UPDATE ${t.table} SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id),
    audit(DB, c.get("user"), "master.update", null, { type: t.label, name: row.main, ...changes }),
  ]);
  return c.json({ ok: true });
});
