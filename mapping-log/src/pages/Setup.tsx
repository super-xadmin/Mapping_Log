import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { PASSWORD_MIN } from "../../shared/labels";
import { api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Spinner } from "../components/ui";

/** ตั้งค่าระบบครั้งแรก: สร้างผู้ดูแลระบบคนแรก */
export default function Setup() {
  const { loading, setupRequired, setupKeyConfigured, refresh } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ setupKey: "", username: "", displayName: "", password: "", confirm: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  if (loading) return <Spinner />;
  if (!setupRequired) return <Navigate to="/login" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (f.password !== f.confirm) return setErr("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
    setBusy(true);
    try {
      await api("/auth/setup", { body: f });
      await refresh();
      nav("/", { replace: true });
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>ตั้งค่าระบบครั้งแรก</h1>
        <p className="muted">สร้างบัญชีผู้ดูแลระบบ (Admin) คนแรก หลังจากนั้นหน้านี้จะปิดใช้งานถาวร</p>
        {!setupKeyConfigured && (
          <div className="alert warn">
            ยังไม่ได้ตั้งค่า <code>SETUP_KEY</code> ใน Cloudflare — ไปที่ Workers &amp; Pages → mapping-log → Settings → Variables and Secrets
            → เพิ่ม Secret ชื่อ <code>SETUP_KEY</code> แล้วกลับมาที่หน้านี้
          </div>
        )}
        <label className="field">
          <span>Setup key (ค่า SETUP_KEY ที่ตั้งไว้ใน Cloudflare)</span>
          <input type="password" required value={f.setupKey} onChange={set("setupKey")} />
        </label>
        <label className="field">
          <span>ชื่อผู้ใช้ (a-z, 0-9, . _ -)</span>
          <input autoCapitalize="none" required pattern="[A-Za-z0-9._\-]{3,32}" value={f.username} onChange={set("username")} />
        </label>
        <label className="field">
          <span>ชื่อที่แสดง</span>
          <input required value={f.displayName} onChange={set("displayName")} placeholder="เช่น สมชาย (หัวหน้าทีม)" />
        </label>
        <label className="field">
          <span>รหัสผ่าน (อย่างน้อย {PASSWORD_MIN} ตัว)</span>
          <input type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={f.password} onChange={set("password")} />
        </label>
        <label className="field">
          <span>ยืนยันรหัสผ่าน</span>
          <input type="password" autoComplete="new-password" required value={f.confirm} onChange={set("confirm")} />
        </label>
        {err && <div className="alert bad">{err}</div>}
        <button className="pri wide" disabled={busy}>สร้างผู้ดูแลระบบ</button>
      </form>
    </div>
  );
}
