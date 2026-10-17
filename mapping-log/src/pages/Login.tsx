import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import type { Me } from "../../shared/types";
import { api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Spinner } from "../components/ui";

export default function Login() {
  const { loading, user, setupRequired, signedIn } = useAuth();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const raw = sp.get("next") ?? "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  if (loading) return <Spinner />;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={user.mustChangePassword ? "/account" : next} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await api<{ user: Me }>("/auth/login", { body: { username, password } });
      signedIn(r.user);
      nav(r.user.mustChangePassword ? "/account" : next, { replace: true });
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Mapping Log</h1>
        <p className="muted">ระบบบันทึกการวิ่งรถ Mapping</p>
        <label className="field">
          <span>ชื่อผู้ใช้</span>
          <input autoComplete="username" autoCapitalize="none" required value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          <span>รหัสผ่าน</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <div className="alert bad">{err}</div>}
        <button className="pri wide" disabled={busy}>{busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button>
        <p className="muted small">ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบเพื่อตั้งรหัสใหม่</p>
      </form>
    </div>
  );
}
