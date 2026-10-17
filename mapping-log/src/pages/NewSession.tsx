// สร้างงาน Mapping ใหม่ (กำหนดรอบ + เวลาตามแผน)
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { bkkDate, fmtClock, fmtDuration, resolvePlannedRounds, type PlannedRoundInput } from "../../shared/time";
import type { Master } from "../../shared/types";
import { api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";
import { can } from "../../shared/labels";

export default function NewSession() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [m, setM] = useState<Master | null>(null);
  const [f, setF] = useState({ title: "", workDate: bkkDate(), driverId: "", vehicleId: "", projectId: "", notes: "", splitRounds: false });
  const [rounds, setRounds] = useState<PlannedRoundInput[]>([{ topic: "", plannedStart: "08:00", plannedEnd: "12:00" }]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Master>("/master").then(setM).catch((e) => setErr(errMsg(e)));
  }, []);

  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const setR = (i: number, k: keyof PlannedRoundInput, v: string) => setRounds((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const plan = f.splitRounds && f.workDate ? resolvePlannedRounds(f.workDate, rounds) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (plan && !plan.ok) return setErr(plan.error);
    setBusy(true);
    try {
      const r = await api<{ id: string }>("/sessions", { body: { ...f, rounds } });
      nav(`/record/${r.id}`);
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  }

  const drivers = m?.drivers.filter((d) => d.active) ?? [];
  const vehicles = m?.vehicles.filter((v) => v.active) ?? [];
  const projects = m?.projects.filter((p) => p.active) ?? [];
  const missing = m && (!drivers.length || !vehicles.length || !projects.length);

  return (
    <form className="card" onSubmit={submit}>
      <h2>สร้างงาน Mapping ใหม่</h2>
      {missing && (
        <div className="alert warn">
          ยังไม่มีคนขับ / รถ / โปรเจกต์ในระบบ{" "}
          {user && can.admin(user.role) ? <Link to="/admin?tab=master">เพิ่มที่หน้าจัดการระบบ</Link> : "กรุณาให้ผู้ดูแลระบบเพิ่มก่อน"}
        </div>
      )}
      <div className="grid">
        <label className="field">
          <span>ชื่องาน *</span>
          <input required maxLength={200} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="เช่น สำรวจถนน 304 ช่วง กม.10–40" />
        </label>
        <label className="field">
          <span>วันที่ทำงาน *</span>
          <input type="date" required value={f.workDate} onChange={(e) => set("workDate", e.target.value)} />
        </label>
        <label className="field">
          <span>โปรเจกต์ / พื้นที่ *</span>
          <select required value={f.projectId} onChange={(e) => set("projectId", e.target.value)}>
            <option value="">เลือก</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.area ? ` (${p.area})` : ""}</option>)}
          </select>
        </label>
        <label className="field">
          <span>คนขับ / ทีม *</span>
          <select required value={f.driverId} onChange={(e) => set("driverId", e.target.value)}>
            <option value="">เลือก</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.team ? ` (${d.team})` : ""}</option>)}
          </select>
        </label>
        <label className="field">
          <span>รถ / อุปกรณ์ *</span>
          <select required value={f.vehicleId} onChange={(e) => set("vehicleId", e.target.value)}>
            <option value="">เลือก</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}{v.equipment ? ` (${v.equipment})` : ""}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span>หมายเหตุ</span>
        <textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>

      <div className="subcard">
        <label className="check big">
          <input type="checkbox" checked={f.splitRounds} onChange={(e) => set("splitRounds", e.target.checked)} />
          แบ่งรอบการเก็บข้อมูล
        </label>
        {!f.splitRounds && <p className="muted">ไม่แบ่งรอบ: ทั้งวันนับเป็น 1 รอบ ระบบบันทึกเวลาเริ่ม–จบจริงให้อัตโนมัติเมื่อกดปุ่ม</p>}
        {f.splitRounds && (
          <>
            <p className="muted">
              ระบุหัวข้อและเวลาที่วางแผนไว้ของทุกรอบ ระบบจะบันทึกเวลาจริงเทียบกับแผนตอนกดเริ่ม/จบ (งานข้ามเที่ยงคืนใส่เวลาตามจริงได้เลย ระบบจะนับเป็นวันถัดไปให้)
            </p>
            <div className="round-list">
              {rounds.map((r, i) => (
                <div className="round-item" key={i}>
                  <div className="row between m0">
                    <b>รอบที่ {i + 1}</b>
                    {rounds.length > 1 && (
                      <button type="button" className="link bad-text" onClick={() => setRounds(rounds.filter((_, j) => j !== i))}>ลบ</button>
                    )}
                  </div>
                  <label className="field">
                    <span>หัวข้อการเก็บ *</span>
                    <input required value={r.topic} maxLength={200} onChange={(e) => setR(i, "topic", e.target.value)} placeholder="เช่น เก็บ LiDAR ฝั่งขาเข้า" />
                  </label>
                  <div className="two-col">
                    <label className="field"><span>เริ่ม *</span><input type="time" required value={r.plannedStart} onChange={(e) => setR(i, "plannedStart", e.target.value)} /></label>
                    <label className="field"><span>ถึง *</span><input type="time" required value={r.plannedEnd} onChange={(e) => setR(i, "plannedEnd", e.target.value)} /></label>
                  </div>
                  <div className="muted small">
                    ตามแผน: {plan?.ok ? `${fmtClock(plan.times[i][0], f.workDate)} – ${fmtClock(plan.times[i][1], f.workDate)} (${fmtDuration(plan.times[i][1] - plan.times[i][0])})` : "-"}
                  </div>
                </div>
              ))}
            </div>
            {plan && !plan.ok && <div className="alert warn">{plan.error}</div>}
            <button type="button" onClick={() => setRounds([...rounds, { topic: "", plannedStart: rounds[rounds.length - 1]?.plannedEnd ?? "", plannedEnd: "" }])}>
              + เพิ่มรอบ
            </button>
          </>
        )}
      </div>
      <p className="muted">ข้อมูล Calibration (เวลาเริ่ม–เสร็จสิ้น) บันทึกในหน้าบันทึก GPS ของงานนี้</p>
      {err && <div className="alert bad">{err}</div>}
      <button className="pri" disabled={busy}>บันทึกและไปหน้าบันทึก GPS</button>
    </form>
  );
}
