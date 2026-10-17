import { useState } from "react";
import { useNavigate } from "react-router";
import { PASSWORD_MIN, ROLE_DESC, ROLE_LABEL } from "../../shared/labels";
import { api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Account() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const forced = user.mustChangePassword;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setOk(false);
    if (f.newPassword !== f.confirm) return setErr("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
    setBusy(true);
    try {
      await api("/auth/password", { body: { currentPassword: f.currentPassword, newPassword: f.newPassword } });
      setF({ currentPassword: "", newPassword: "", confirm: "" });
      setOk(true);
      await refresh();
      if (forced) nav("/", { replace: true });
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <div className="card">
        <h2>บัญชีของฉัน</h2>
        <p>
          <b>{user.displayName}</b> <span className="muted">({user.username})</span>
          <br />
          สิทธิ์: {ROLE_LABEL[user.role]} <span className="muted">— {ROLE_DESC[user.role]}</span>
        </p>
      </div>
      <form className="card" onSubmit={submit}>
        <h3>เปลี่ยนรหัสผ่าน</h3>
        {forced && <div className="alert warn">กรุณาตั้งรหัสผ่านใหม่ของคุณเองก่อนเริ่มใช้งาน (รหัสที่ได้รับจากผู้ดูแลเป็นรหัสชั่วคราว)</div>}
        <label className="field">
          <span>รหัสผ่านปัจจุบัน</span>
          <input type="password" autoComplete="current-password" required value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
        </label>
        <label className="field">
          <span>รหัสผ่านใหม่ (อย่างน้อย {PASSWORD_MIN} ตัว)</span>
          <input type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
        </label>
        <label className="field">
          <span>ยืนยันรหัสผ่านใหม่</span>
          <input type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </label>
        {err && <div className="alert bad">{err}</div>}
        {ok && <div className="alert ok">เปลี่ยนรหัสผ่านเรียบร้อย (เครื่องอื่นที่ล็อกอินไว้จะถูกออกจากระบบ)</div>}
        <button className="pri" disabled={busy}>บันทึกรหัสผ่านใหม่</button>
      </form>
    </div>
  );
}
