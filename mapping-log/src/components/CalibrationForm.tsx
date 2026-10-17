// ฟอร์มกรอกเวลา Calibration เอง (ชม.:นาที) — ใช้ทั้งเพิ่มใหม่และแก้ไข
import { useState } from "react";
import { CAL_KINDS, CAL_LABEL, type CalKind } from "../../shared/labels";
import { bkkHHMM, dayOffset, fmtClock, fmtDuration, resolveCalTimes } from "../../shared/time";
import type { Calibration } from "../../shared/types";
import { api, errMsg } from "../lib/api";

type Props = {
  sessionId: string;
  workDate: string;
  initial?: Calibration;
  onDone: () => void;
  onCancel: () => void;
};

export default function CalibrationForm({ sessionId, workDate, initial, onDone, onCancel }: Props) {
  const [kind, setKind] = useState<CalKind>(initial?.kind ?? "pre");
  const [start, setStart] = useState(initial?.startedAt ? bkkHHMM(initial.startedAt) : "");
  const [end, setEnd] = useState(initial?.endedAt ? bkkHHMM(initial.endedAt) : "");
  const [nextDay, setNextDay] = useState(initial?.startedAt ? dayOffset(initial.startedAt, workDate) > 0 : false);
  const [note, setNote] = useState(initial?.note ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const preview = start ? resolveCalTimes(workDate, start, end || null, nextDay) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!preview || !preview.ok) return setErr(preview && !preview.ok ? preview.error : "กรุณาระบุเวลาเริ่ม");
    setBusy(true);
    try {
      const body = { kind, start, end: end || null, startNextDay: nextDay, note };
      if (initial) await api(`/calibrations/${initial.id}`, { method: "PATCH", body });
      else await api(`/sessions/${sessionId}/calibrations`, { body });
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="subcard" onSubmit={submit}>
      <div className="grid">
        <label className="field">
          <span>ประเภท</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as CalKind)}>
            {CAL_KINDS.map((k) => <option key={k} value={k}>{CAL_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>เวลาเริ่ม (ชม.:นาที) *</span>
          <input type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span>เวลาเสร็จสิ้น (ชม.:นาที)</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="field">
          <span>หมายเหตุ</span>
          <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="เช่น Static 5 นาที + วิ่งเลข 8" />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={nextDay} onChange={(e) => setNextDay(e.target.checked)} />
        เริ่มหลังเที่ยงคืน (วันถัดจากวันทำงาน)
      </label>
      {preview?.ok && (
        <p className="muted">
          จะบันทึกเป็น: {fmtClock(preview.startedAt, workDate)} – {preview.endedAt ? fmtClock(preview.endedAt, workDate) : "ยังไม่เสร็จ"}
          {preview.endedAt ? ` (${fmtDuration(preview.endedAt - preview.startedAt)})` : ""}
        </p>
      )}
      {err && <div className="alert bad">{err}</div>}
      <div className="row">
        <button className="pri" disabled={busy}>{initial ? "บันทึกการแก้ไข" : "เพิ่ม Calibration"}</button>
        <button type="button" onClick={onCancel}>ยกเลิก</button>
      </div>
    </form>
  );
}
