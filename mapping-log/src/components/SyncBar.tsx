// แถบสถานะการส่งข้อมูล: ออนไลน์/ออฟไลน์, รอส่งกี่รายการ, ส่งล่าสุดเมื่อไหร่
import { useEffect, useState } from "react";
import { bkkHHMMSS } from "../../shared/time";
import { clearFailed, syncNow, syncStore } from "../lib/outbox";
import { useStore } from "../lib/store";

const OP_LABEL: Record<string, string> = {
  "round.add": "เพิ่มรอบ", "round.start": "เริ่มรอบ", "round.end": "จบรอบ", chunk: "พิกัด GPS",
  "cal.start": "เริ่ม Calibration", "cal.end": "เสร็จสิ้น Calibration",
};

export default function SyncBar({ compact = false }: { compact?: boolean }) {
  const s = useStore(syncStore);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (compact && !s.pending && !s.lastError && !s.failed.length && online && !s.storageError) return null;
  const cls = s.storageError || s.authError ? "bad" : !online || s.lastError ? "warn" : "ok";
  return (
    <div className={`syncbar ${cls}`}>
      <span className="dot" />
      <span>
        {online ? "ออนไลน์" : "ออฟไลน์"} · รอส่ง <b>{s.pending}</b> รายการ
        {s.syncing ? " · กำลังส่ง…" : s.lastOkAt ? ` · ส่งล่าสุด ${bkkHHMMSS(s.lastOkAt)}` : ""}
      </span>
      {s.pending > 0 && !s.syncing && (
        <button className="link" onClick={() => void syncNow()}>ส่งตอนนี้</button>
      )}
      {s.lastError && <div className="small">{s.lastError}</div>}
      {s.storageError && <div className="small">พื้นที่เก็บข้อมูลในเครื่องเต็มหรือใช้ไม่ได้ (ปิดโหมดไม่ระบุตัวตน / ล้างพื้นที่)</div>}
      {s.failed.length > 0 && (
        <details className="small">
          <summary>มี {s.failed.length} รายการที่เซิร์ฟเวอร์ไม่รับ</summary>
          <ul>
            {s.failed.map((f, i) => (
              <li key={i}>
                {bkkHHMMSS(f.at)} {OP_LABEL[f.k] ?? f.k}{f.points ? ` (${f.points} จุด)` : ""}: {f.error}
              </li>
            ))}
          </ul>
          <button className="link" onClick={clearFailed}>ล้างรายการนี้</button>
        </details>
      )}
    </div>
  );
}
