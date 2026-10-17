// สิทธิ์ผู้ใช้ สถานะ และข้อความที่ใช้ร่วมกันทั้งฝั่งเว็บและ Worker

export type Role = "admin" | "qc" | "field" | "viewer";
export const ROLES: Role[] = ["admin", "qc", "field", "viewer"];
export const ROLE_LABEL: Record<Role, string> = {
  admin: "ผู้ดูแลระบบ",
  qc: "ผู้ตรวจ QC",
  field: "ทีมภาคสนาม",
  viewer: "ดูอย่างเดียว",
};
export const ROLE_DESC: Record<Role, string> = {
  admin: "ทำได้ทุกอย่าง รวมถึงจัดการผู้ใช้ ข้อมูลหลัก และลบงาน",
  qc: "บันทึกงานได้ และเปลี่ยนสถานะ QC ได้",
  field: "สร้างงาน บันทึก GPS และ Calibration ได้ แต่เปลี่ยนสถานะ QC ไม่ได้",
  viewer: "ดูประวัติ แผนที่ และ export ได้อย่างเดียว",
};
export const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as string[]).includes(r);

/** ตารางสิทธิ์ (ตรวจซ้ำที่ Worker ทุกครั้ง หน้าเว็บใช้แค่ซ่อนปุ่ม) */
export const can = {
  record: (r: Role) => r === "admin" || r === "qc" || r === "field",
  qc: (r: Role) => r === "admin" || r === "qc",
  admin: (r: Role) => r === "admin",
};

export type QcStatus = "PENDING" | "PASSED" | "REDO";
export const QC_STATUSES: QcStatus[] = ["PENDING", "PASSED", "REDO"];
export const QC_LABEL: Record<QcStatus, string> = { PENDING: "รอตรวจ", PASSED: "ผ่าน", REDO: "ต้องวิ่งซ่อม" };
export const isQc = (s: unknown): s is QcStatus => typeof s === "string" && (QC_STATUSES as string[]).includes(s);

export type CalKind = "pre" | "mid" | "post";
export const CAL_KINDS: CalKind[] = ["pre", "mid", "post"];
export const CAL_LABEL: Record<CalKind, string> = { pre: "ก่อนวิ่ง", mid: "ระหว่างวัน", post: "หลังวิ่ง" };
export const isCalKind = (k: unknown): k is CalKind => typeof k === "string" && (CAL_KINDS as string[]).includes(k);

export const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
export const PASSWORD_MIN = 8;

export function passwordProblem(pw: unknown, username?: string): string | null {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) return `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN} ตัวอักษร`;
  if (pw.length > 128) return "รหัสผ่านยาวเกินไป";
  if (username && pw.toLowerCase() === username.toLowerCase()) return "รหัสผ่านต้องไม่เหมือนชื่อผู้ใช้";
  return null;
}
