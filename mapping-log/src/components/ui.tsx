import type { ReactNode } from "react";
import { QC_LABEL, type QcStatus } from "../../shared/labels";
import { calComplete, type Calibration } from "../../shared/types";

export function QcBadge({ status }: { status: QcStatus }) {
  return <span className={`badge qc-${status}`}>{QC_LABEL[status]}</span>;
}

export function CalBadge({ cals }: { cals: Calibration[] }) {
  if (calComplete(cals)) return <span className="badge ok">Calibration ครบ</span>;
  if (cals.some((c) => c.startedAt && !c.endedAt)) return <span className="badge warn">Calibration ยังไม่เสร็จ</span>;
  return <span className="badge bad">ไม่มี Calibration</span>;
}

export function Pending() {
  return <span className="badge pending" title="ข้อมูลนี้ยังอยู่ในเครื่อง รอส่งขึ้นเซิร์ฟเวอร์">รอซิงก์</span>;
}

export function Spinner({ text = "กำลังโหลด…" }: { text?: string }) {
  return <div className="muted center pad">{text}</div>;
}

export function ErrorBox({ error, onRetry }: { error: string | null | undefined; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="alert bad">
      {error} {onRetry && <button className="link" onClick={onRetry}>ลองใหม่</button>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}
