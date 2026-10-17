// จัดการระบบ (ผู้ดูแลระบบ): ผู้ใช้งาน, ข้อมูลหลัก, ประวัติการใช้งานทั้งระบบ
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PASSWORD_MIN, ROLES, ROLE_DESC, ROLE_LABEL, type Role } from "../../shared/labels";
import { fmtDateTime, fmtThaiDate } from "../../shared/time";
import type { AuditEntry, Master, UserRow } from "../../shared/types";
import { api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";
import { describeAudit } from "../lib/auditText";
import { ErrorBox } from "../components/ui";

const TABS = { users: "ผู้ใช้งาน", master: "คนขับ / รถ / โปรเจกต์", audit: "ประวัติการใช้งาน" } as const;
type Tab = keyof typeof TABS;

export default function Admin() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) in TABS ? (sp.get("tab") as Tab) : "users";
  return (
    <>
      <div className="tabs">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button key={t} className={t === tab ? "active" : ""} onClick={() => setSp({ tab: t })}>{TABS[t]}</button>
        ))}
      </div>
      {tab === "users" && <Users />}
      {tab === "master" && <MasterData />}
      {tab === "audit" && <AuditLog />}
    </>
  );
}

function tempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => chars[b % chars.length]).join("");
}

function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [err, setErr] = useState("");
  const [f, setF] = useState({ username: "", displayName: "", role: "field" as Role, password: tempPassword() });
  const [created, setCreated] = useState<string | null>(null);
  const load = useCallback(() => api<UserRow[]>("/users").then(setUsers).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await api("/users", { body: f });
      setCreated(`สร้างบัญชี ${f.username} แล้ว — รหัสผ่านชั่วคราว: ${f.password} (ผู้ใช้ต้องเปลี่ยนรหัสเมื่อเข้าสู่ระบบครั้งแรก)`);
      setF({ username: "", displayName: "", role: "field", password: tempPassword() });
      void load();
    } catch (e) {
      setErr(errMsg(e));
    }
  }
  async function patch(u: UserRow, body: Record<string, unknown>, done?: string) {
    setErr("");
    try {
      await api(`/users/${u.id}`, { method: "PATCH", body });
      if (done) setCreated(done);
      void load();
    } catch (e) {
      setErr(errMsg(e));
    }
  }
  function resetPw(u: UserRow) {
    const pw = tempPassword();
    if (confirm(`ตั้งรหัสผ่านใหม่ให้ ${u.displayName}?\nรหัสชั่วคราวคือ: ${pw}\n(ผู้ใช้จะถูกออกจากระบบทุกเครื่อง และต้องเปลี่ยนรหัสเมื่อเข้าสู่ระบบ)`))
      void patch(u, { password: pw }, `ตั้งรหัสผ่านใหม่ให้ ${u.username} แล้ว — รหัสชั่วคราว: ${pw}`);
  }

  return (
    <>
      <form className="card" onSubmit={create}>
        <h3>เพิ่มผู้ใช้งาน</h3>
        <div className="grid">
          <label className="field"><span>ชื่อผู้ใช้ (ใช้ล็อกอิน)</span>
            <input required autoCapitalize="none" pattern="[A-Za-z0-9._\-]{3,32}" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></label>
          <label className="field"><span>ชื่อที่แสดง</span>
            <input required value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></label>
          <label className="field"><span>สิทธิ์</span>
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select></label>
          <label className="field"><span>รหัสผ่านชั่วคราว (≥ {PASSWORD_MIN} ตัว)</span>
            <input required minLength={PASSWORD_MIN} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        </div>
        <p className="muted small">{ROLE_DESC[f.role]}</p>
        <button className="pri">สร้างบัญชี</button>
      </form>
      {created && <div className="alert ok">{created}</div>}
      <ErrorBox error={err} />
      <div className="card table-wrap">
        <table className="cards-on-mobile">
          <thead><tr><th>ผู้ใช้</th><th>สิทธิ์</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? "" : "inactive"}>
                <td data-label="ผู้ใช้"><b>{u.displayName}</b><div className="muted small">{u.username}</div></td>
                <td data-label="สิทธิ์">
                  <select value={u.role} disabled={u.id === me?.id} onChange={(e) => void patch(u, { role: e.target.value })}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
                <td data-label="สถานะ">
                  {!u.active ? <span className="badge">ปิดใช้งาน</span> : u.lockedUntil ? <span className="badge bad">ถูกล็อกชั่วคราว</span> : <span className="badge ok">ใช้งาน</span>}
                  {u.mustChangePassword && <div className="muted small">รอเปลี่ยนรหัสผ่าน</div>}
                </td>
                <td data-label="เข้าใช้ล่าสุด" className="small">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "-"}</td>
                <td className="nowrap">
                  <button className="link" onClick={() => resetPw(u)}>ตั้งรหัสใหม่</button>
                  {u.lockedUntil && <button className="link" onClick={() => void patch(u, { unlock: true })}>ปลดล็อก</button>}
                  {u.id !== me?.id && (
                    <button className="link" onClick={() => void patch(u, { active: !u.active })}>{u.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const MASTER = {
  drivers: { title: "คนขับ / ทีม", main: ["name", "ชื่อคนขับ"], sub: ["team", "ทีม"] },
  vehicles: { title: "รถ / อุปกรณ์", main: ["plate", "ทะเบียนรถ"], sub: ["equipment", "อุปกรณ์ / เซนเซอร์"] },
  projects: { title: "โปรเจกต์ / พื้นที่", main: ["name", "ชื่อโปรเจกต์"], sub: ["area", "พื้นที่ / โซน"] },
} as const;
type MKey = keyof typeof MASTER;

function MasterData() {
  const [m, setM] = useState<Master | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => api<Master>("/master").then(setM).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <ErrorBox error={err} />
      <div className="grid three">
        {(Object.keys(MASTER) as MKey[]).map((k) => (
          <MasterSection key={k} k={k} rows={(m?.[k] ?? []) as unknown as Record<string, string | boolean | null>[]} reload={load} onError={setErr} />
        ))}
      </div>
    </>
  );
}

function MasterSection({ k, rows, reload, onError }: { k: MKey; rows: Record<string, string | boolean | null>[]; reload: () => void; onError: (e: string) => void }) {
  const c = MASTER[k];
  const [main, setMain] = useState("");
  const [sub, setSub] = useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/master/${k}`, { body: { [c.main[0]]: main, [c.sub[0]]: sub } });
      setMain("");
      setSub("");
      reload();
    } catch (e) {
      onError(errMsg(e));
    }
  }
  async function toggle(id: string, active: boolean) {
    if (!active && !confirm("ปิดใช้งานรายการนี้? (ข้อมูลย้อนหลังยังอยู่ครบ และเปิดใช้งานใหม่ได้)")) return;
    try {
      await api(`/master/${k}/${id}`, { method: "PATCH", body: { active } });
      reload();
    } catch (e) {
      onError(errMsg(e));
    }
  }
  return (
    <div className="card">
      <h3>{c.title}</h3>
      <form className="stack" onSubmit={add}>
        <input required placeholder={c.main[1]} value={main} onChange={(e) => setMain(e.target.value)} />
        <input placeholder={c.sub[1]} value={sub} onChange={(e) => setSub(e.target.value)} />
        <button className="pri">เพิ่ม</button>
      </form>
      <table className="compact">
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.id)} className={r.active ? "" : "inactive"}>
              <td>{String(r[c.main[0]] ?? "")}<div className="muted small">{String(r[c.sub[0]] ?? "")}</div></td>
              <td className="right">
                <button className="link" onClick={() => void toggle(String(r.id), !r.active)}>{r.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(async (before?: number) => {
    try {
      const r = await api<{ entries: AuditEntry[]; hasMore: boolean }>(`/audit?limit=100${before ? `&before=${before}` : ""}`);
      setEntries((old) => (before ? [...old, ...r.entries] : r.entries));
      setHasMore(r.hasMore);
    } catch (e) {
      setErr(errMsg(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="card table-wrap">
      <ErrorBox error={err} />
      <table className="cards-on-mobile">
        <thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>รายการ</th><th>งาน</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td data-label="เวลา" className="nowrap small">{fmtDateTime(e.at)}</td>
              <td data-label="ผู้ใช้">{e.userName ?? "-"}</td>
              <td data-label="รายการ">{describeAudit(e, e.workDate ?? undefined)}</td>
              <td data-label="งาน">
                {e.sessionId && e.sessionTitle ? (
                  <Link to={`/sessions/${e.sessionId}`}>{e.sessionTitle}<span className="muted small"> ({fmtThaiDate(e.workDate)})</span></Link>
                ) : e.sessionId ? <span className="muted small">(งานถูกลบแล้ว)</span> : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && <div className="center pad"><button onClick={() => void load(entries[entries.length - 1]?.id)}>โหลดเพิ่ม</button></div>}
    </div>
  );
}
