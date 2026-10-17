import type { ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router";
import { ROLE_LABEL, can, type Role } from "../shared/labels";
import { AuthProvider, useAuth } from "./lib/auth";
import { api } from "./lib/api";
import { syncStore } from "./lib/outbox";
import { recStore } from "./lib/recorder";
import { useStore } from "./lib/store";
import SyncBar from "./components/SyncBar";
import { ErrorBox, Spinner } from "./components/ui";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Account from "./pages/Account";
import Dashboard from "./pages/Dashboard";
import NewSession from "./pages/NewSession";
import Recorder from "./pages/Recorder";
import SessionDetail from "./pages/SessionDetail";
import Admin from "./pages/Admin";

function Guard({ children }: { children: ReactNode }) {
  const { loading, user, setupRequired, error, refresh } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!user) {
    if (error) return <main><ErrorBox error={error} onRetry={() => void refresh()} /></main>;
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  if (user.mustChangePassword && loc.pathname !== "/account") return <Navigate to="/account" replace />;
  return <>{children}</>;
}

function RoleGate({ need, children }: { need: (r: Role) => boolean; children: ReactNode }) {
  const { user } = useAuth();
  if (user && need(user.role)) return <>{children}</>;
  return <div className="card">บัญชีของคุณไม่มีสิทธิ์เข้าหน้านี้</div>;
}

function Layout() {
  const { user, offline, signedOut } = useAuth();
  const rec = useStore(recStore);
  const sync = useStore(syncStore);
  const loc = useLocation();
  const nav = useNavigate();
  if (!user) return null;
  const onRecorder = loc.pathname.startsWith("/record/");
  const recSession = (rec.active ?? rec.cal)?.sessionId;

  async function logout() {
    if (rec.active) return alert("กรุณาจบรอบที่กำลังบันทึก GPS ก่อนออกจากระบบ");
    if (sync.pending && !confirm(`ยังมีข้อมูลรอส่ง ${sync.pending} รายการ\nข้อมูลยังเก็บอยู่ในเครื่องนี้ และจะส่งเมื่อเข้าสู่ระบบอีกครั้ง\n\nต้องการออกจากระบบหรือไม่?`)) return;
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    signedOut();
    nav("/login", { replace: true });
  }

  return (
    <>
      <header className="top">
        <Link to="/" className="brand">Mapping Log</Link>
        <nav>
          <NavLink to="/" end>ประวัติงาน</NavLink>
          {can.record(user.role) && <NavLink to="/sessions/new">+ งานใหม่</NavLink>}
          {can.admin(user.role) && <NavLink to="/admin">จัดการระบบ</NavLink>}
        </nav>
        <div className="me">
          <NavLink to="/account" title="บัญชีของฉัน">{user.displayName}</NavLink>
          <span className="role">{ROLE_LABEL[user.role]}</span>
          <button className="link light" onClick={() => void logout()}>ออกจากระบบ</button>
        </div>
      </header>
      {offline && <div className="banner warn">ออฟไลน์ — แสดงข้อมูลที่จำไว้ในเครื่อง การบันทึก GPS ยังทำงานตามปกติ</div>}
      {recSession && !onRecorder && (
        <div className="banner rec">
          <span className="dot live" /> {rec.active ? `กำลังบันทึก GPS: ${rec.active.label}` : "กำลังทำ Calibration"} —{" "}
          <Link to={`/record/${recSession}`}>กลับไปหน้าบันทึก</Link>
        </div>
      )}
      <main>
        {!onRecorder && <SyncBar compact />}
        <Outlet />
      </main>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />
        <Route element={<Guard><Layout /></Guard>}>
          <Route index element={<Dashboard />} />
          <Route path="sessions/new" element={<RoleGate need={can.record}><NewSession /></RoleGate>} />
          <Route path="sessions/:id" element={<SessionDetail />} />
          <Route path="record/:id" element={<Recorder />} />
          <Route path="admin" element={<RoleGate need={can.admin}><Admin /></RoleGate>} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<div className="card">ไม่พบหน้านี้ — <Link to="/">กลับหน้าแรก</Link></div>} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
