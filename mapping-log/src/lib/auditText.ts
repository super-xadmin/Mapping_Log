// แปลงประวัติการใช้งานเป็นข้อความภาษาไทย
import { CAL_LABEL, QC_LABEL, ROLE_LABEL, type CalKind, type QcStatus, type Role } from "../../shared/labels";
import type { AuditEntry } from "../../shared/types";
import { fmtClock, fmtThaiDate } from "../../shared/time";

const FIELD: Record<string, string> = {
  title: "ชื่องาน", notes: "หมายเหตุ", driver_id: "คนขับ", vehicle_id: "รถ", project_id: "โปรเจกต์",
};

type D = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export function describeAudit(e: AuditEntry, workDate?: string): string {
  const d: D = e.detail ?? {};
  const clock = (v: unknown) => fmtClock(typeof v === "number" ? v : null, workDate);
  const kind = (v: unknown) => CAL_LABEL[v as CalKind] ?? s(v);
  const cal = (v: unknown) => {
    const x = (v ?? {}) as D;
    return `${kind(x.kind)} ${clock(x.startedAt)}–${x.endedAt == null ? "ยังไม่เสร็จ" : clock(x.endedAt)}${x.note ? ` (${s(x.note)})` : ""}`;
  };
  const seq = d.seq ? ` ${s(d.seq)}` : "";
  switch (e.action) {
    case "session.create":
      return `สร้างงาน "${s(d.title)}"${d.splitRounds ? ` แบ่ง ${s(d.rounds)} รอบ` : ""}`;
    case "session.update":
      return `แก้ไขข้อมูลงาน (${Object.keys((d.changes as D) ?? {}).map((k) => FIELD[k] ?? k).join(", ")})`;
    case "session.delete":
      return `ลบงาน "${s(d.title)}" (${fmtThaiDate(s(d.workDate))})`;
    case "round.add":
      return `เพิ่มรอบ: ${s(d.topic)}`;
    case "round.start":
      return `เริ่มรอบ${seq}: ${s(d.topic)} เวลา ${clock(d.t)}`;
    case "round.end":
      return `จบรอบ${seq}: ${s(d.topic)} เวลา ${clock(d.t)}`;
    case "cal.start":
      return `เริ่ม Calibration (${kind(d.kind)}) เวลา ${clock(d.t)}`;
    case "cal.end":
      return `เสร็จสิ้น Calibration (${kind(d.kind)}) เวลา ${clock(d.t)}`;
    case "cal.create":
      return `เพิ่ม Calibration แบบกรอกเวลา: ${cal(d)}`;
    case "cal.update":
      return `แก้ไข Calibration ครั้งที่ ${s(d.seq)}: ${cal(d.before)} → ${cal(d.after)}`;
    case "cal.delete":
      return `ลบ Calibration ครั้งที่ ${s(d.seq)} (${cal(d.before)})`;
    case "qc.update":
      return `สถานะ QC: ${QC_LABEL[d.from as QcStatus] ?? s(d.from)} → ${QC_LABEL[d.to as QcStatus] ?? s(d.to)}${d.note ? ` — ${s(d.note)}` : ""}`;
    case "auth.setup":
      return `ตั้งค่าระบบครั้งแรก (ผู้ดูแล: ${s(d.username)})`;
    case "auth.login":
      return "เข้าสู่ระบบ";
    case "auth.login_failed":
      return `เข้าสู่ระบบไม่สำเร็จ (${s(d.username)})`;
    case "auth.locked":
      return `บัญชี ${s(d.username)} ถูกล็อกชั่วคราว (ใส่รหัสผ่านผิดหลายครั้ง)`;
    case "auth.password_change":
      return "เปลี่ยนรหัสผ่านของตัวเอง";
    case "user.create":
      return `สร้างผู้ใช้ ${s(d.username)} (${ROLE_LABEL[d.role as Role] ?? s(d.role)})`;
    case "user.update": {
      const parts: string[] = [];
      if (d.role) parts.push(`สิทธิ์ → ${ROLE_LABEL[d.role as Role] ?? s(d.role)}`);
      if (d.active === false) parts.push("ปิดใช้งาน");
      if (d.active === true) parts.push("เปิดใช้งาน");
      if (d.passwordReset) parts.push("ตั้งรหัสผ่านใหม่");
      if (d.unlocked) parts.push("ปลดล็อก");
      if (d.displayName) parts.push(`ชื่อ → ${s(d.displayName)}`);
      return `แก้ไขผู้ใช้ ${s(d.username)}${parts.length ? `: ${parts.join(", ")}` : ""}`;
    }
    case "master.create":
      return `เพิ่ม${s(d.type)}: ${s(d.name)}${d.detail ? ` (${s(d.detail)})` : ""}`;
    case "master.update":
      return `แก้ไข${s(d.type)}: ${s(d.name)}${d.active === false ? " — ปิดใช้งาน" : d.active === true ? " — เปิดใช้งาน" : ""}`;
    default:
      return e.action;
  }
}
