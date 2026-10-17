-- Mapping Log: โครงสร้างฐานข้อมูลเริ่มต้น (Cloudflare D1 / SQLite)
-- เวลาทั้งหมดเก็บเป็น epoch milliseconds (UTC) ส่วน work_date เป็นวันที่ตามเวลาไทย 'YYYY-MM-DD'

-- ผู้ใช้งานและการล็อกอิน -------------------------------------------------------
CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name         TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('admin', 'qc', 'field', 'viewer')),
  password_hash        TEXT NOT NULL,
  active               INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins        INTEGER NOT NULL DEFAULT 0,
  locked_until         INTEGER,
  created_at           INTEGER NOT NULL,
  last_login_at        INTEGER
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,           -- SHA-256 ของ token ใน cookie (ไม่เก็บ token จริง)
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

-- ข้อมูลหลัก ------------------------------------------------------------------
CREATE TABLE drivers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  team       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE vehicles (
  id         TEXT PRIMARY KEY,
  plate      TEXT NOT NULL,
  equipment  TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  area       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- งาน Mapping (1 รายการ = 1 วันทำงาน) ------------------------------------------
CREATE TABLE mapping_sessions (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  work_date    TEXT NOT NULL,
  split_rounds INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  qc_status    TEXT NOT NULL DEFAULT 'PENDING' CHECK (qc_status IN ('PENDING', 'PASSED', 'REDO')),
  qc_note      TEXT,
  qc_by        TEXT REFERENCES users(id),
  qc_at        INTEGER,
  driver_id    TEXT NOT NULL REFERENCES drivers(id),
  vehicle_id   TEXT NOT NULL REFERENCES vehicles(id),
  project_id   TEXT NOT NULL REFERENCES projects(id),
  created_by   TEXT REFERENCES users(id),
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_sessions_date ON mapping_sessions(work_date, created_at);

-- รอบการเก็บข้อมูล --------------------------------------------------------------
CREATE TABLE rounds (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES mapping_sessions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  topic         TEXT NOT NULL,
  planned_start INTEGER,
  planned_end   INTEGER,
  started_at    INTEGER,
  ended_at      INTEGER,
  started_by    TEXT REFERENCES users(id),
  ended_by      TEXT REFERENCES users(id),
  point_count   INTEGER NOT NULL DEFAULT 0,  -- สรุปสะสม อัปเดตทุกครั้งที่รับพิกัด
  distance_m    REAL NOT NULL DEFAULT 0,
  last_t        INTEGER,
  last_lat      REAL,
  last_lng      REAL,
  UNIQUE (session_id, seq)
);

-- Calibration (วันละหลายครั้งได้ เช่น ก่อนวิ่ง / หลังวิ่ง) --------------------------
CREATE TABLE calibrations (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES mapping_sessions(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('pre', 'mid', 'post')),
  started_at INTEGER,
  ended_at   INTEGER,
  note       TEXT,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX idx_calibrations_session ON calibrations(session_id);

-- พิกัด GPS เก็บเป็นก้อน (chunk) ละหลายจุด เพื่อลดจำนวนแถวที่เขียนใน D1 ------------------
-- pts = JSON [[dt_ms, lat, lng, accuracy_m, speed_ms, heading, altitude], ...]  (t = t_start + dt)
CREATE TABLE track_chunks (
  id       INTEGER PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  t_start  INTEGER NOT NULL,
  t_end    INTEGER NOT NULL,
  n        INTEGER NOT NULL,
  pts      TEXT NOT NULL,
  UNIQUE (round_id, t_start)
);

-- ประวัติการใช้งาน (ใครทำอะไร เมื่อไหร่) ---------------------------------------------
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  at         INTEGER NOT NULL,
  user_id    TEXT,
  user_name  TEXT,
  action     TEXT NOT NULL,
  session_id TEXT,
  detail     TEXT
);
CREATE INDEX idx_audit_session ON audit_log(session_id, at);
CREATE INDEX idx_audit_at ON audit_log(at);
