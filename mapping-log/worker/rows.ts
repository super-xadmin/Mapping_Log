// คำสั่ง SELECT และตัวแปลงแถวจาก D1 เป็นรูปแบบที่หน้าเว็บใช้
import type { CalKind, QcStatus } from "../shared/labels";
import type { Calibration, Round, Session } from "../shared/types";

export const SESSION_SELECT = `
SELECT s.id, s.title, s.work_date, s.split_rounds, s.notes, s.qc_status, s.qc_note, s.qc_at,
       qu.display_name AS qc_by_name,
       s.driver_id, d.name AS driver_name, d.team AS driver_team,
       s.vehicle_id, v.plate AS vehicle_plate, v.equipment AS vehicle_equipment,
       s.project_id, p.name AS project_name, p.area AS project_area,
       cu.display_name AS created_by_name, s.created_at
FROM mapping_sessions s
JOIN drivers d ON d.id = s.driver_id
JOIN vehicles v ON v.id = s.vehicle_id
JOIN projects p ON p.id = s.project_id
LEFT JOIN users cu ON cu.id = s.created_by
LEFT JOIN users qu ON qu.id = s.qc_by`;

export const ROUND_SELECT = `
SELECT r.id, r.session_id, r.seq, r.topic, r.planned_start, r.planned_end, r.started_at, r.ended_at,
       su.display_name AS started_by_name, eu.display_name AS ended_by_name,
       r.point_count, r.distance_m, r.last_t
FROM rounds r
LEFT JOIN users su ON su.id = r.started_by
LEFT JOIN users eu ON eu.id = r.ended_by`;

export const CAL_SELECT = `
SELECT c.id, c.session_id, c.seq, c.kind, c.started_at, c.ended_at, c.note,
       u.display_name AS created_by_name, c.created_at, c.updated_at
FROM calibrations c
LEFT JOIN users u ON u.id = c.created_by`;

export type SessionDb = {
  id: string; title: string; work_date: string; split_rounds: number; notes: string | null;
  qc_status: QcStatus; qc_note: string | null; qc_at: number | null; qc_by_name: string | null;
  driver_id: string; driver_name: string; driver_team: string | null;
  vehicle_id: string; vehicle_plate: string; vehicle_equipment: string | null;
  project_id: string; project_name: string; project_area: string | null;
  created_by_name: string | null; created_at: number;
};
export type RoundDb = {
  id: string; session_id: string; seq: number; topic: string;
  planned_start: number | null; planned_end: number | null; started_at: number | null; ended_at: number | null;
  started_by_name: string | null; ended_by_name: string | null;
  point_count: number; distance_m: number; last_t: number | null;
};
export type CalDb = {
  id: string; session_id: string; seq: number; kind: CalKind; started_at: number | null; ended_at: number | null;
  note: string | null; created_by_name: string | null; created_at: number; updated_at: number | null;
};

export const toRound = (r: RoundDb): Round => ({
  id: r.id,
  seq: r.seq,
  topic: r.topic,
  plannedStart: r.planned_start,
  plannedEnd: r.planned_end,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  startedBy: r.started_by_name,
  endedBy: r.ended_by_name,
  pointCount: r.point_count,
  distanceM: r.distance_m,
  lastT: r.last_t,
});

export const toCal = (c: CalDb): Calibration => ({
  id: c.id,
  seq: c.seq,
  kind: c.kind,
  startedAt: c.started_at,
  endedAt: c.ended_at,
  note: c.note,
  createdBy: c.created_by_name,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
});

export function toSession(s: SessionDb, rounds: RoundDb[], cals: CalDb[]): Session {
  return {
    id: s.id,
    title: s.title,
    workDate: s.work_date,
    splitRounds: !!s.split_rounds,
    notes: s.notes,
    qcStatus: s.qc_status,
    qcNote: s.qc_note,
    qcBy: s.qc_by_name,
    qcAt: s.qc_at,
    driver: { id: s.driver_id, name: s.driver_name, team: s.driver_team },
    vehicle: { id: s.vehicle_id, plate: s.vehicle_plate, equipment: s.vehicle_equipment },
    project: { id: s.project_id, name: s.project_name, area: s.project_area },
    createdBy: s.created_by_name,
    createdAt: s.created_at,
    rounds: rounds.filter((r) => r.session_id === s.id).map(toRound),
    calibrations: cals.filter((c) => c.session_id === s.id).map(toCal),
  };
}
