// รายละเอียดงาน: ข้อมูล, Calibration, รอบ, แผนที่ + เล่นย้อนหลัง, QC, ประวัติการทำงาน, Export
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { fmtKm, pathDistance } from "../../shared/geo";
import { CAL_LABEL, QC_LABEL, QC_STATUSES, can, type QcStatus } from "../../shared/labels";
import { bkkHHMMSS, fmtClock, fmtDateTime, fmtDuration, fmtThaiDate } from "../../shared/time";
import { calComplete, type AuditEntry, type Calibration, type Master, type Session } from "../../shared/types";
import { ApiError, api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";
import { describeAudit } from "../lib/auditText";
import { exportGeoJson, exportGpx, exportPointsCsv } from "../lib/exporters";
import { decodeTrack, type TP, type TrackResponse } from "../lib/track";
import CalibrationForm from "../components/CalibrationForm";
import TrackMap, { COLORS } from "../components/TrackMap";
import { CalBadge, ErrorBox, QcBadge, Spinner } from "../components/ui";

function Delay({ planned, actual }: { planned: number | null; actual: number | null }) {
  if (planned == null || actual == null) return null;
  const m = Math.round((actual - planned) / 60_000);
  if (Math.abs(m) < 5) return <span className="muted small"> (ตรงเวลา)</span>;
  return <span className={`small ${m > 0 ? "warn-text" : "ok-text"}`}> ({m > 0 ? `ช้า ${m}` : `เร็ว ${-m}`} นาที)</span>;
}

export default function SessionDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [s, setS] = useState<Session | null>(null);
  const [tracks, setTracks] = useState<Record<string, TP[]>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [err, setErr] = useState("");
  const [calEdit, setCalEdit] = useState<Calibration | "new" | null>(null);
  const [editInfo, setEditInfo] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [playRound, setPlayRound] = useState("");
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sess, tr, au] = await Promise.all([
        api<Session>(`/sessions/${id}`),
        api<TrackResponse>(`/sessions/${id}/track`),
        api<AuditEntry[]>(`/sessions/${id}/audit`),
      ]);
      setS(sess);
      setTracks(decodeTrack(tr));
      setAudit(au);
      setErr("");
    } catch (e) {
      setErr(errMsg(e));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const pr = s?.rounds.find((r) => r.id === playRound) ?? s?.rounds.find((r) => tracks[r.id]?.length);
  const prPts = pr ? tracks[pr.id] ?? [] : [];
  const pp = prPts.length ? prPts[Math.min(idx, prPts.length - 1)] : null;

  useEffect(() => {
    setIdx(0);
    setPlaying(false);
  }, [pr?.id]);
  useEffect(() => {
    if (!playing || !prPts.length) return;
    const step = Math.max(1, Math.ceil(prPts.length / 300));
    const t = setInterval(() => {
      setIdx((i) => {
        if (i >= prPts.length - 1) {
          setPlaying(false);
          return i;
        }
        return Math.min(prPts.length - 1, i + step);
      });
    }, 100);
    return () => clearInterval(t);
  }, [playing, prPts.length]);

  const mapTracks = useMemo(
    () =>
      (s?.rounds ?? [])
        .filter((r) => !hidden[r.id])
        .map((r) => ({
          id: r.id,
          color: COLORS[(r.seq - 1) % COLORS.length],
          label: s!.splitRounds ? `รอบ ${r.seq}: ${r.topic}` : r.topic,
          points: (tracks[r.id] ?? []).map((p) => [p.lat, p.lng] as [number, number]),
        })),
    [s, tracks, hidden],
  );

  if (!s) return err ? <ErrorBox error={err} onRetry={() => void load()} /> : <Spinner />;

  const canRec = !!user && can.record(user.role);
  const locked = s.qcStatus === "PASSED";
  const editable = canRec && !locked;
  const dist = (rid: string) => pathDistance(tracks[rid] ?? []);
  const total = s.rounds.reduce((a, r) => a + dist(r.id), 0);
  const hasTrack = s.rounds.some((r) => tracks[r.id]?.length);

  async function delCal(c: Calibration) {
    if (!confirm(`ลบ Calibration ครั้งที่ ${c.seq}? (ระบบจะเก็บประวัติการลบไว้)`)) return;
    try {
      await api(`/calibrations/${c.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      alert(errMsg(e));
    }
  }
  async function delSession() {
    if (!confirm(`ลบงาน "${s!.title}" และข้อมูล GPS ทั้งหมด?\nการลบย้อนกลับไม่ได้`)) return;
    try {
      await api(`/sessions/${s!.id}`, { method: "DELETE" });
      nav("/", { replace: true });
    } catch (e) {
      alert(errMsg(e));
    }
  }

  return (
    <>
      <div className="card">
        <div className="row between">
          <div>
            <h2 className="m0">{s.title}</h2>
            <div className="row small">
              <QcBadge status={s.qcStatus} />
              <CalBadge cals={s.calibrations} />
              <span className="muted">{fmtThaiDate(s.workDate)} · ระยะรวม {fmtKm(total)} · {s.rounds.length} รอบ</span>
            </div>
          </div>
          <div className="row">
            {editable && <Link className="btn pri" to={`/record/${s.id}`}>บันทึก GPS</Link>}
            <button disabled={!hasTrack} onClick={() => exportGpx(s, tracks)}>GPX</button>
            <button disabled={!hasTrack} onClick={() => exportGeoJson(s, tracks)}>GeoJSON</button>
            <button disabled={!hasTrack} onClick={() => exportPointsCsv(s, tracks)}>CSV</button>
          </div>
        </div>
        {editInfo ? (
          <EditInfo s={s} onDone={() => { setEditInfo(false); void load(); }} onCancel={() => setEditInfo(false)} />
        ) : (
          <div className="grid info">
            <div><label>โปรเจกต์ / พื้นที่</label>{s.project.name}<div className="muted small">{s.project.area}</div></div>
            <div><label>คนขับ / ทีม</label>{s.driver.name}<div className="muted small">{s.driver.team}</div></div>
            <div><label>รถ / อุปกรณ์</label>{s.vehicle.plate}<div className="muted small">{s.vehicle.equipment}</div></div>
            <div><label>หมายเหตุ</label>{s.notes || "-"}</div>
            <div><label>สร้างโดย</label>{s.createdBy ?? "-"}<div className="muted small">{fmtDateTime(s.createdAt)}</div></div>
          </div>
        )}
        <div className="row">
          {editable && !editInfo && <button className="link" onClick={() => setEditInfo(true)}>แก้ไขข้อมูลงาน</button>}
          {user && can.admin(user.role) && <button className="link bad-text" onClick={() => void delSession()}>ลบงานนี้</button>}
        </div>
      </div>

      {/* ---------- Calibration ---------- */}
      <div className="card">
        <div className="row between">
          <h3 className="m0">Calibration</h3>
          {editable && calEdit === null && <button onClick={() => setCalEdit("new")}>+ เพิ่ม (กรอกเวลา)</button>}
        </div>
        {!calComplete(s.calibrations) && (
          <div className="alert bad">ยังไม่มีข้อมูล Calibration ที่มีทั้งเวลาเริ่มและเวลาเสร็จสิ้น — งานนี้จะผ่าน QC ไม่ได้</div>
        )}
        {s.calibrations.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>ประเภท</th><th>เริ่ม</th><th>เสร็จสิ้น</th><th>ใช้เวลา</th><th>ผู้บันทึก</th><th>หมายเหตุ</th><th></th></tr></thead>
              <tbody>
                {s.calibrations.map((c) => (
                  <tr key={c.id}>
                    <td>{c.seq}</td>
                    <td>{CAL_LABEL[c.kind]}</td>
                    <td className="nowrap">{fmtClock(c.startedAt, s.workDate)}</td>
                    <td className="nowrap">{c.endedAt ? fmtClock(c.endedAt, s.workDate) : <span className="warn-text">ยังไม่เสร็จ</span>}</td>
                    <td className="nowrap">{c.startedAt && c.endedAt ? fmtDuration(c.endedAt - c.startedAt) : "-"}</td>
                    <td>{c.createdBy ?? "-"}{c.updatedAt && <div className="muted small">แก้ไขล่าสุด {fmtDateTime(c.updatedAt)}</div>}</td>
                    <td>{c.note ?? ""}</td>
                    <td className="nowrap">
                      {editable && (
                        <>
                          <button className="link" onClick={() => setCalEdit(c)}>แก้ไข</button>{" "}
                          <button className="link bad-text" onClick={() => void delCal(c)}>ลบ</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {calEdit && (
          <CalibrationForm
            key={calEdit === "new" ? "new" : calEdit.id}
            sessionId={s.id}
            workDate={s.workDate}
            initial={calEdit === "new" ? undefined : calEdit}
            onCancel={() => setCalEdit(null)}
            onDone={() => { setCalEdit(null); void load(); }}
          />
        )}
      </div>

      {/* ---------- รอบ ---------- */}
      <div className="card table-wrap">
        <h3>{s.splitRounds ? "รอบการเก็บข้อมูล" : "ช่วงเวลาการเก็บข้อมูล (ไม่แบ่งรอบ)"}</h3>
        <table>
          <thead>
            <tr><th>แสดง</th><th>รอบ</th><th>หัวข้อการเก็บ</th><th>เวลาตามแผน</th><th>เวลาจริง</th><th>ใช้เวลา</th><th>ระยะ</th><th>จุด GPS</th><th>ผู้บันทึก</th></tr>
          </thead>
          <tbody>
            {s.rounds.map((r) => (
              <tr key={r.id}>
                <td><input type="checkbox" checked={!hidden[r.id]} onChange={(e) => setHidden({ ...hidden, [r.id]: !e.target.checked })} /></td>
                <td><span className="swatch" style={{ background: COLORS[(r.seq - 1) % COLORS.length] }} />{r.seq}</td>
                <td>{r.topic}</td>
                <td className="nowrap">{r.plannedStart ? `${fmtClock(r.plannedStart, s.workDate)} – ${fmtClock(r.plannedEnd, s.workDate)}` : "-"}</td>
                <td>
                  {r.startedAt ? (
                    <>
                      {fmtClock(r.startedAt, s.workDate)}<Delay planned={r.plannedStart} actual={r.startedAt} /> –{" "}
                      {r.endedAt ? <>{fmtClock(r.endedAt, s.workDate)}<Delay planned={r.plannedEnd} actual={r.endedAt} /></> : <b className="live-text">กำลังวิ่ง</b>}
                    </>
                  ) : (
                    <span className="muted">ยังไม่เริ่ม</span>
                  )}
                </td>
                <td className="nowrap">{r.startedAt && r.endedAt ? fmtDuration(r.endedAt - r.startedAt) : "-"}</td>
                <td className="nowrap">{fmtKm(dist(r.id))}</td>
                <td>{tracks[r.id]?.length ?? 0}</td>
                <td className="small">{r.startedBy ?? "-"}{r.endedBy && r.endedBy !== r.startedBy ? ` / ${r.endedBy}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------- แผนที่ + เล่นย้อนหลัง ---------- */}
      <div className="card">
        {hasTrack ? (
          <div className="row">
            <b>เล่นย้อนหลัง:</b>
            <select className="auto" value={pr?.id ?? ""} onChange={(e) => setPlayRound(e.target.value)}>
              {s.rounds.map((r) => (
                <option key={r.id} value={r.id} disabled={!tracks[r.id]?.length}>รอบ {r.seq}: {r.topic}</option>
              ))}
            </select>
            <button onClick={() => setPlaying(!playing)} disabled={!prPts.length}>{playing ? "❚❚ หยุด" : "▶ เล่น"}</button>
            <input className="grow" type="range" min={0} max={Math.max(0, prPts.length - 1)} value={Math.min(idx, Math.max(0, prPts.length - 1))} onChange={(e) => setIdx(Number(e.target.value))} />
            <span className="muted small nowrap">
              {pp && `${bkkHHMMSS(pp.t)} · ${pp.spd != null ? `${(pp.spd * 3.6).toFixed(0)} กม./ชม. · ` : ""}±${pp.acc?.toFixed(0) ?? "-"} ม.`}
            </span>
          </div>
        ) : (
          <p className="muted">ยังไม่มีข้อมูล GPS</p>
        )}
        {hasTrack && <TrackMap tracks={mapTracks} marker={pp ? [pp.lat, pp.lng] : null} fitKey={`${s.id}:${hasTrack}`} />}
      </div>

      <div className="grid two">
        {user && can.qc(user.role) && <QcPanel s={s} onDone={() => void load()} />}
        <div className="card">
          <h3>ประวัติการทำงาน (ใครทำอะไร เมื่อไหร่)</h3>
          <ul className="timeline">
            {audit.map((e) => (
              <li key={e.id}>
                <span className="muted small nowrap">{fmtDateTime(e.at)}</span>
                <span>{describeAudit(e, s.workDate)}</span>
                <span className="muted small">{e.userName ?? "ระบบ"}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function QcPanel({ s, onDone }: { s: Session; onDone: () => void }) {
  const [status, setStatus] = useState<QcStatus>(s.qcStatus);
  const [note, setNote] = useState(s.qcNote ?? "");
  const [err, setErr] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const checks = [
    { ok: calComplete(s.calibrations), text: "มีข้อมูล Calibration (เวลาเริ่มและเสร็จสิ้น)" },
    { ok: !s.rounds.some((r) => r.startedAt && !r.endedAt), text: "ไม่มีรอบที่ยังวิ่งค้างอยู่" },
    { ok: s.rounds.some((r) => r.endedAt), text: "มีรอบที่วิ่งเสร็จอย่างน้อย 1 รอบ" },
  ];
  async function save() {
    setErr([]);
    setBusy(true);
    try {
      await api(`/sessions/${s.id}/qc`, { method: "PATCH", body: { status, note } });
      onDone();
    } catch (e) {
      const problems = e instanceof ApiError && e.data && typeof e.data === "object" ? (e.data as { problems?: string[] }).problems : undefined;
      setErr(problems ?? [errMsg(e)]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card">
      <h3>ตรวจสอบคุณภาพ (QC)</h3>
      <ul className="checklist">
        {checks.map((c) => <li key={c.text} className={c.ok ? "ok-text" : "bad-text"}>{c.ok ? "✓" : "✗"} {c.text}</li>)}
      </ul>
      <label className="field">
        <span>สถานะ</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as QcStatus)}>
          {QC_STATUSES.map((k) => <option key={k} value={k}>{QC_LABEL[k]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>หมายเหตุ</span>
        <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ช่วง กม.22–25 สัญญาณ GPS หลุด ต้องวิ่งซ่อม" />
      </label>
      {err.length > 0 && <div className="alert bad">{err.map((x) => <div key={x}>{x}</div>)}</div>}
      <button className="pri" disabled={busy} onClick={() => void save()}>บันทึก QC</button>
      {s.qcBy && <p className="muted small">ตรวจล่าสุดโดย {s.qcBy} เมื่อ {fmtDateTime(s.qcAt)}</p>}
      {s.qcStatus === "PASSED" && <p className="muted small">งานที่ผ่าน QC จะถูกล็อก ถ้าต้องแก้ไขให้เปลี่ยนสถานะเป็น “รอตรวจ” หรือ “ต้องวิ่งซ่อม” ก่อน</p>}
    </div>
  );
}

function EditInfo({ s, onDone, onCancel }: { s: Session; onDone: () => void; onCancel: () => void }) {
  const [m, setM] = useState<Master | null>(null);
  const [f, setF] = useState({ title: s.title, notes: s.notes ?? "", driverId: s.driver.id, vehicleId: s.vehicle.id, projectId: s.project.id });
  const [err, setErr] = useState("");
  useEffect(() => {
    api<Master>("/master").then(setM).catch((e) => setErr(errMsg(e)));
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/sessions/${s.id}`, { method: "PATCH", body: f });
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    }
  }
  const opt = <T extends { id: string; active: boolean }>(xs: T[] | undefined, cur: string, label: (x: T) => string) =>
    (xs ?? []).filter((x) => x.active || x.id === cur).map((x) => <option key={x.id} value={x.id}>{label(x)}</option>);
  return (
    <form className="subcard" onSubmit={save}>
      <div className="grid">
        <label className="field"><span>ชื่องาน</span><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field"><span>โปรเจกต์</span><select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>{opt(m?.projects, f.projectId, (p) => p.name)}</select></label>
        <label className="field"><span>คนขับ</span><select value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })}>{opt(m?.drivers, f.driverId, (d) => d.name)}</select></label>
        <label className="field"><span>รถ</span><select value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}>{opt(m?.vehicles, f.vehicleId, (v) => v.plate)}</select></label>
      </div>
      <label className="field"><span>หมายเหตุ</span><textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      {err && <div className="alert bad">{err}</div>}
      <div className="row"><button className="pri">บันทึก</button><button type="button" onClick={onCancel}>ยกเลิก</button></div>
    </form>
  );
}
