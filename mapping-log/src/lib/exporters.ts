// สร้างไฟล์ GPX / GeoJSON / CSV ในเบราว์เซอร์ (ไม่ใช้ CPU ของ Worker)
import { pathDistance } from "../../shared/geo";
import { CAL_LABEL, QC_LABEL } from "../../shared/labels";
import { bkkDate, bkkHHMMSS, fmtClock } from "../../shared/time";
import type { Session } from "../../shared/types";
import type { TP } from "./track";

const xml = (v: string) => v.replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch]!);
const csvCell = (v: unknown) => {
  const t = v == null ? "" : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
const local = (t: number) => `${bkkDate(t)} ${bkkHHMMSS(t)}`;

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const baseName = (s: Session) => `mapping_${s.workDate}_${s.id.slice(0, 8)}`;

export function calSummary(s: Session): string {
  if (!s.calibrations.length) return "ไม่มีข้อมูล Calibration";
  return s.calibrations
    .map((c) => `${CAL_LABEL[c.kind]} ${fmtClock(c.startedAt, s.workDate)}-${c.endedAt ? fmtClock(c.endedAt, s.workDate) : "ยังไม่เสร็จ"}`)
    .join("; ");
}

export function exportGpx(s: Session, tracks: Record<string, TP[]>) {
  const trk = s.rounds
    .filter((r) => tracks[r.id]?.length)
    .map((r) => {
      const pts = tracks[r.id]
        .map((p) => `      <trkpt lat="${p.lat}" lon="${p.lng}">${p.alt != null ? `<ele>${p.alt}</ele>` : ""}<time>${new Date(p.t).toISOString()}</time></trkpt>`)
        .join("\n");
      return `  <trk>\n    <name>${xml(`รอบ ${r.seq}: ${r.topic}`)}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>`;
    })
    .join("\n");
  const desc = `${s.project.name} | ${s.driver.name} | ${s.vehicle.plate} | Calibration: ${calSummary(s)} | QC: ${QC_LABEL[s.qcStatus]}`;
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Mapping Log" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(s.title)}</name><desc>${xml(desc)}</desc><time>${new Date(s.createdAt).toISOString()}</time></metadata>
${trk}
</gpx>`;
  download(`${baseName(s)}.gpx`, gpx, "application/gpx+xml");
}

export function exportGeoJson(s: Session, tracks: Record<string, TP[]>) {
  const fc = {
    type: "FeatureCollection",
    properties: {
      title: s.title, workDate: s.workDate, project: s.project.name, area: s.project.area, driver: s.driver.name, team: s.driver.team,
      vehicle: s.vehicle.plate, equipment: s.vehicle.equipment, qcStatus: s.qcStatus, qcNote: s.qcNote,
      calibrations: s.calibrations.map((c) => ({
        kind: c.kind,
        startedAt: c.startedAt ? new Date(c.startedAt).toISOString() : null,
        endedAt: c.endedAt ? new Date(c.endedAt).toISOString() : null,
        note: c.note,
      })),
    },
    features: s.rounds
      .filter((r) => tracks[r.id]?.length)
      .map((r) => ({
        type: "Feature",
        properties: {
          round: r.seq, topic: r.topic,
          startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
          endedAt: r.endedAt ? new Date(r.endedAt).toISOString() : null,
          points: tracks[r.id].length, distance_m: Math.round(pathDistance(tracks[r.id])),
        },
        geometry: { type: "LineString", coordinates: tracks[r.id].map((p) => (p.alt != null ? [p.lng, p.lat, p.alt] : [p.lng, p.lat])) },
      })),
  };
  download(`${baseName(s)}.geojson`, JSON.stringify(fc), "application/geo+json");
}

export function exportPointsCsv(s: Session, tracks: Record<string, TP[]>) {
  const rows: unknown[][] = [["round", "topic", "time_utc", "time_bangkok", "lat", "lng", "accuracy_m", "speed_kmh", "heading", "altitude_m"]];
  for (const r of s.rounds)
    for (const p of tracks[r.id] ?? [])
      rows.push([r.seq, r.topic, new Date(p.t).toISOString(), local(p.t), p.lat, p.lng, p.acc, p.spd == null ? "" : (p.spd * 3.6).toFixed(1), p.hdg, p.alt]);
  download(`${baseName(s)}_points.csv`, csv(rows), "text/csv;charset=utf-8");
}

/** สรุปหลายงาน (จากหน้าประวัติ) เป็น CSV สำหรับทำรายงาน */
export function exportSummaryCsv(sessions: Session[]) {
  const rows: unknown[][] = [[
    "วันที่", "ชื่องาน", "โปรเจกต์", "พื้นที่", "คนขับ", "ทีม", "รถ", "อุปกรณ์", "Calibration", "Calibration ครบ",
    "จำนวนรอบ", "เริ่มวิ่ง (จริง)", "จบ (จริง)", "ระยะทางรวม (กม.)", "จุด GPS", "สถานะ QC", "หมายเหตุ QC", "ผู้สร้าง",
  ]];
  for (const s of sessions) {
    const started = s.rounds.map((r) => r.startedAt).filter((x): x is number => x != null);
    const ended = s.rounds.map((r) => r.endedAt).filter((x): x is number => x != null);
    rows.push([
      s.workDate, s.title, s.project.name, s.project.area, s.driver.name, s.driver.team, s.vehicle.plate, s.vehicle.equipment,
      calSummary(s), s.calibrations.some((c) => c.startedAt && c.endedAt) ? "ครบ" : "ไม่มี",
      s.rounds.length,
      started.length ? fmtClock(Math.min(...started), s.workDate) : "",
      ended.length ? fmtClock(Math.max(...ended), s.workDate) : "",
      (s.rounds.reduce((a, r) => a + r.distanceM, 0) / 1000).toFixed(2),
      s.rounds.reduce((a, r) => a + r.pointCount, 0),
      QC_LABEL[s.qcStatus], s.qcNote, s.createdBy,
    ]);
  }
  download(`mapping_summary_${bkkDate()}.csv`, csv(rows), "text/csv;charset=utf-8");
}
