// หน้าบันทึกภาคสนาม (มือถือ): Calibration + รอบการวิ่ง + GPS — ทำงานได้แม้ออฟไลน์
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { fmtKm } from "../../shared/geo";
import { CAL_KINDS, CAL_LABEL, can, type CalKind } from "../../shared/labels";
import { fmtClock, fmtDuration, fmtThaiDate } from "../../shared/time";
import { calComplete, type Round, type Session } from "../../shared/types";
import { api, errMsg, isOffline } from "../lib/api";
import { useAuth } from "../lib/auth";
import { pendingOps, syncEvents, syncStore } from "../lib/outbox";
import { MAX_ACCURACY_M, liveTrack, recStore, recorder } from "../lib/recorder";
import { lsGet, lsSet, useStore } from "../lib/store";
import { applyPending } from "../lib/track";
import CalibrationForm from "../components/CalibrationForm";
import SyncBar from "../components/SyncBar";
import TrackMap from "../components/TrackMap";
import { CalBadge, ErrorBox, Pending, QcBadge, Spinner } from "../components/ui";

const cacheKey = (id: string) => `mlog:sess:${id}`;

export default function Recorder() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const rec = useStore(recStore);
  useStore(syncStore); // แสดงผลใหม่เมื่อคิวเปลี่ยน
  const [server, setServer] = useState<Session | null>(() => lsGet<Session | null>(cacheKey(id), null));
  const [fromCache, setFromCache] = useState(false);
  const [err, setErr] = useState("");
  const [calKind, setCalKind] = useState<CalKind>("pre");
  const [manual, setManual] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [tick, setTick] = useState(0);
  const fetchedAt = useRef(0); // เวลาที่เริ่มโหลดข้อมูลชุดล่าสุดจากเซิร์ฟเวอร์

  const load = useCallback(async () => {
    try {
      const startedAt = Date.now();
      const s = await api<Session>(`/sessions/${id}`);
      fetchedAt.current = startedAt;
      setServer(s);
      setFromCache(false);
      setErr("");
      lsSet(cacheKey(id), s);
    } catch (e) {
      if (isOffline(e)) setFromCache(true);
      else setErr(errMsg(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
    const onSynced = (e: Event) => {
      if ((e as CustomEvent<string[]>).detail.includes(id)) void load();
    };
    syncEvents.addEventListener("synced", onSynced);
    const refresh = setInterval(() => navigator.onLine && void load(), 60_000); // รับการเปลี่ยนแปลงจากเครื่องอื่น
    return () => {
      syncEvents.removeEventListener("synced", onSynced);
      clearInterval(refresh);
    };
  }, [id, load]);
  useEffect(() => recorder.attachView(), []);
  // Calibration ที่เริ่มในเครื่องนี้ แต่ถูกกดเสร็จ/ลบจากที่อื่นแล้ว → เลิกแสดงว่ากำลังทำ
  const localCal = rec.cal?.sessionId === id ? rec.cal : null;
  useEffect(() => {
    if (!server || !localCal) return;
    const c = server.calibrations.find((x) => x.id === localCal.calId);
    if (c?.endedAt != null) return recorder.forgetCal(localCal.calId);
    // ถูกลบ: ไม่มีในข้อมูลที่โหลดหลังเริ่มเกิน 30 วินาที และไม่มีรายการค้างส่ง
    const pending = pendingOps(id).some((o) => (o.k === "cal.start" || o.k === "cal.end") && o.calId === localCal.calId);
    if (!c && !pending && fetchedAt.current > localCal.startedAt + 30_000) recorder.forgetCal(localCal.calId);
  }, [server, localCal, id]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 2000); // อัปเดตแผนที่/ตัวจับเวลาทุก 2 วินาที
    return () => clearInterval(t);
  }, []);

  const s = server ? applyPending(server, pendingOps(id)) : null;
  const activeHere = rec.active?.sessionId === id ? rec.active : null;
  const activeElsewhere = rec.active && rec.active.sessionId !== id ? rec.active : null;
  const calElsewhere = rec.cal && rec.cal.sessionId !== id ? rec.cal : null;

  const mapTracks = useMemo(
    () => [{ id: "live", label: "เส้นทางรอบนี้", color: "#1f6feb", points: activeHere ? liveTrack.slice() : [] }],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, activeHere?.roundId],
  );

  if (!s) return err ? <ErrorBox error={err} onRetry={() => void load()} /> : <Spinner />;

  const canRec = !!user && can.record(user.role);
  const locked = s.qcStatus === "PASSED";
  const editable = canRec && !locked;
  const openCals = s.calibrations.filter((c) => c.startedAt != null && c.endedAt == null);
  const hasCal = calComplete(s.calibrations);
  const now = Date.now();
  void tick;

  function startCal() {
    if (activeHere) return alert("กรุณาจบรอบที่กำลังวิ่งก่อนเริ่ม Calibration");
    if (calElsewhere) return alert("มี Calibration ของงานอื่นที่ยังไม่เสร็จในเครื่องนี้");
    recorder.startCal(id, calKind);
  }

  function startRound(r: Round) {
    if (activeElsewhere) return alert(`เครื่องนี้กำลังบันทึกงานอื่นอยู่: ${activeElsewhere.label}`);
    if (openCals.length) return alert('กรุณากด "เสร็จสิ้น Calibration" ก่อนเริ่มวิ่ง');
    if (!hasCal && !confirm("ยังไม่มีข้อมูล Calibration ที่เสร็จสมบูรณ์\nงานนี้จะยังผ่าน QC ไม่ได้จนกว่าจะบันทึก Calibration\n\nต้องการเริ่มวิ่งเลยหรือไม่?")) return;
    recorder.startRound(id, r.id, `${s!.title} — รอบ ${r.seq}: ${r.topic}`);
  }

  function endRound() {
    if (activeHere && confirm(`จบรอบนี้?\n${activeHere.label}`)) recorder.endRound();
  }

  function resumeRound(r: Round) {
    if (activeElsewhere) return alert(`เครื่องนี้กำลังบันทึกงานอื่นอยู่: ${activeElsewhere.label}`);
    if (confirm(`รอบ ${r.seq} ถูกเริ่มไว้แล้ว (อาจจากเครื่องอื่น) ต้องการบันทึก GPS ต่อบนเครื่องนี้หรือไม่?`))
      recorder.resumeRound(id, r.id, r.startedAt!, `${s!.title} — รอบ ${r.seq}: ${r.topic}`);
  }

  function addRound() {
    const topic = newTopic.trim();
    if (!topic) return;
    recorder.addRound(id, topic);
    setNewTopic("");
  }

  const pos = rec.pos;
  return (
    <div className="recorder">
      <div className="card">
        <div className="row between">
          <div>
            <h2 className="m0">{s.title}</h2>
            <div className="muted small">
              {fmtThaiDate(s.workDate)} · {s.project.name} · {s.driver.name} · {s.vehicle.plate}
              {s.vehicle.equipment ? ` (${s.vehicle.equipment})` : ""}
            </div>
          </div>
          <div className="row">
            <QcBadge status={s.qcStatus} />
            <CalBadge cals={s.calibrations} />
            <Link to={`/sessions/${s.id}`}>รายละเอียด →</Link>
          </div>
        </div>
        {fromCache && <div className="alert warn small">ออฟไลน์ — แสดงข้อมูลที่จำไว้ในเครื่อง การบันทึกยังทำงานตามปกติ</div>}
      </div>

      <SyncBar />
      {locked && <div className="alert ok">งานนี้ผ่าน QC แล้ว — ข้อมูลถูกล็อก ไม่สามารถบันทึกเพิ่มได้</div>}
      {!canRec && <div className="alert warn">บัญชีของคุณเป็นแบบดูอย่างเดียว ไม่สามารถบันทึกได้</div>}
      {activeElsewhere && (
        <div className="alert warn">
          เครื่องนี้กำลังบันทึกงานอื่นอยู่: {activeElsewhere.label} — <Link to={`/record/${activeElsewhere.sessionId}`}>ไปที่งานนั้น</Link>
        </div>
      )}
      {rec.gpsError && <div className="alert bad">GPS: {rec.gpsError}</div>}

      {/* ---------- Calibration ---------- */}
      <div className="card">
        <div className="row between">
          <h3 className="m0">Calibration</h3>
          {!hasCal && <span className="badge bad">ต้องมีอย่างน้อย 1 ครั้งก่อน QC ผ่าน</span>}
        </div>
        {s.calibrations.length > 0 && (
          <table className="compact">
            <thead><tr><th>#</th><th>ประเภท</th><th>เริ่ม</th><th>เสร็จสิ้น</th><th>ใช้เวลา</th><th></th></tr></thead>
            <tbody>
              {s.calibrations.map((c) => (
                <tr key={c.id}>
                  <td>{c.seq}</td>
                  <td>{CAL_LABEL[c.kind]} {c.pending && <Pending />}</td>
                  <td>{fmtClock(c.startedAt, s.workDate)}</td>
                  <td>{c.endedAt ? fmtClock(c.endedAt, s.workDate) : <b className="live-text">กำลังทำ</b>}</td>
                  <td>{c.startedAt ? fmtDuration((c.endedAt ?? now) - c.startedAt) : "-"}</td>
                  <td>{!c.endedAt && editable && <button className="warn-btn" onClick={() => recorder.endCal(id, c.id)}>■ เสร็จสิ้น</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {editable && (
          <>
            {openCals.length ? (
              <button className="warn-btn rec-btn" onClick={() => recorder.endCal(id, openCals[0].id)}>
                ■ เสร็จสิ้น Calibration ({CAL_LABEL[openCals[0].kind]} เริ่ม {fmtClock(openCals[0].startedAt, s.workDate)} · {fmtDuration(now - (openCals[0].startedAt ?? now))})
              </button>
            ) : (
              <div className="row">
                <select value={calKind} onChange={(e) => setCalKind(e.target.value as CalKind)} className="auto">
                  {CAL_KINDS.map((k) => <option key={k} value={k}>{CAL_LABEL[k]}</option>)}
                </select>
                <button className="pri grow" onClick={startCal} disabled={!!activeHere}>▶ เริ่ม Calibration</button>
              </div>
            )}
            {!manual ? (
              <button className="link small" onClick={() => setManual(true)}>ลืมกดปุ่ม? กรอกเวลาเอง</button>
            ) : (
              <CalibrationForm sessionId={id} workDate={s.workDate} onCancel={() => setManual(false)} onDone={() => { setManual(false); void load(); }} />
            )}
          </>
        )}
      </div>

      {/* ---------- รอบการวิ่ง ---------- */}
      {activeHere ? (
        <div className="card active-round">
          <div className="small">
            <span className="dot live" /> กำลังบันทึก — <b>{activeHere.label}</b>
          </div>
          <div className="stats">
            <div><span>เวลาวิ่ง</span><b>{fmtDuration(now - activeHere.startedAt)}</b></div>
            <div><span>ระยะทาง</span><b>{fmtKm(rec.dist)}</b></div>
            <div><span>ความเร็ว</span><b>{rec.speed != null ? `${(rec.speed * 3.6).toFixed(0)} กม./ชม.` : "-"}</b></div>
            <div>
              <span>ความแม่นยำ GPS</span>
              <b className={pos && pos.acc > MAX_ACCURACY_M ? "bad-text" : ""}>{pos ? `±${pos.acc.toFixed(0)} ม.` : "รอสัญญาณ"}</b>
            </div>
            <div><span>จุดที่บันทึก</span><b>{rec.count}</b></div>
            <div><span>กันจอดับ</span><b>{rec.wakeLock ? "เปิด" : "ไม่รองรับ"}</b></div>
          </div>
          <button className="bad rec-btn" onClick={endRound}>■ จบรอบนี้</button>
        </div>
      ) : (
        <div className="card">
          <h3 className="m0">{s.splitRounds ? "เลือกรอบเพื่อเริ่มบันทึก" : "การวิ่งเก็บข้อมูล"}</h3>
          <div className="round-rows">
            {s.rounds.map((r) => (
              <div className="round-row" key={r.id}>
                <div className="grow">
                  <b>{s.splitRounds ? `รอบ ${r.seq}: ` : ""}{r.topic}</b> {r.pending && <Pending />}
                  <div className="muted small">
                    {r.plannedStart ? `แผน ${fmtClock(r.plannedStart, s.workDate)}–${fmtClock(r.plannedEnd, s.workDate)} · ` : ""}
                    {r.startedAt ? `จริง ${fmtClock(r.startedAt, s.workDate)}–${r.endedAt ? fmtClock(r.endedAt, s.workDate) : "…"}` : "ยังไม่เริ่ม"}
                    {r.pointCount ? ` · ${r.pointCount} จุด` : ""}
                  </div>
                </div>
                <div>
                  {r.endedAt ? (
                    <span className="badge ok">เสร็จ</span>
                  ) : !editable ? null : r.startedAt ? (
                    <button onClick={() => resumeRound(r)}>ทำต่อ</button>
                  ) : (
                    <button className="pri" onClick={() => startRound(r)}>▶ เริ่ม</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {s.splitRounds && editable && (
            <div className="row">
              <input className="grow" placeholder="เพิ่มรอบ: หัวข้อการเก็บ" value={newTopic} maxLength={200} onChange={(e) => setNewTopic(e.target.value)} />
              <button onClick={addRound} disabled={!newTopic.trim()}>+ เพิ่มรอบ</button>
            </div>
          )}
        </div>
      )}

      <TrackMap height={380} follow tracks={mapTracks} marker={pos ? [pos.lat, pos.lng] : null} />
      <p className="muted small">
        {pos ? `ตำแหน่งปัจจุบัน ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)} (±${pos.acc.toFixed(0)} ม.)` : rec.watching ? "กำลังหาสัญญาณ GPS…" : ""}
        <br />
        เปิดหน้าจอค้างไว้ระหว่างวิ่ง (มือถืออาจหยุด GPS เมื่อปิดจอหรือสลับไปแอปอื่น) ข้อมูลเก็บในเครื่องก่อน ถ้าเน็ตหลุดจะส่งให้อัตโนมัติ
      </p>
    </div>
  );
}
