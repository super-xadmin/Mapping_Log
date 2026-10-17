import type { Role } from "../shared/labels";

export interface Env {
  DB: D1Database;
  /** รหัสสำหรับสร้างผู้ดูแลระบบคนแรก (ตั้งเป็น Secret ใน Cloudflare) */
  SETUP_KEY?: string;
  /** จำนวนรอบ PBKDF2 (ค่าเริ่มต้นและค่าสูงสุด 100000, ต่ำสุด 10000) */
  PBKDF2_ITERATIONS?: string;
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
  tokenHash: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
