// แปลงข้อมูลพิกัดจากเซิร์ฟเวอร์/คิวในเครื่อง และรวมรายการที่ยังไม่ได้ส่งเข้ากับข้อมูลที่แสดง
import type { PtArr, Session, SyncOp } from "../../shared/types";

export type TP = { t: number; lat: number; lng: number; acc: number | null; spd: number | null; hdg: number | null; alt: number | null };
export type TrackResponse = { rounds: Record<string, [number, PtArr[]][]> };

export function decodeChunks(chunks: [number, PtArr[]][]): TP[] {
  const out: TP[] = [];
  for (const [t0, pts] of chunks)
    for (const p of pts) out.push({ t: t0 + p[0], lat: p[1], lng: p[2], acc: p[3], spd: p[4], hdg: p[5], alt: p[6] });
  return out;
}

/** รวมหลายแหล่ง เรียงตามเวลา และตัดจุดซ้ำ (เวลาเดียวกัน) */
export function mergeByTime(...lists: TP[][]): TP[] {
  const map = new Map<number, TP>();
  for (const list of lists) for (const p of list) if (!map.has(p.t)) map.set(p.t, p);
  return [...map.values()].sort((a, b) => a.t - b.t);
}

export function decodeTrack(res: TrackResponse): Record<string, TP[]> {
  const out: Record<string, TP[]> = {};
  for (const [rid, chunks] of Object.entries(res.rounds)) out[rid] = mergeByTime(decodeChunks(chunks));
  return out;
}

/** จุดที่ยังรอส่งในเครื่อง ของรอบที่ระบุ */
export function pendingPoints(ops: SyncOp[], roundId: string): TP[] {
  const chunks: [number, PtArr[]][] = [];
  for (const op of ops) if (op.k === "chunk" && op.roundId === roundId) chunks.push([op.t0, op.pts]);
  return decodeChunks(chunks);
}

/** แสดงผลรวมข้อมูลจากเซิร์ฟเวอร์ + รายการที่ยังรอส่ง (ทำเครื่องหมาย pending) */
export function applyPending(s: Session, ops: SyncOp[]): Session {
  const rounds = s.rounds.map((r) => ({ ...r }));
  const cals = s.calibrations.map((c) => ({ ...c }));
  const nextSeq = (xs: { seq: number }[]) => xs.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
  for (const op of ops) {
    switch (op.k) {
      case "round.add":
        if (!rounds.some((r) => r.id === op.roundId))
          rounds.push({
            id: op.roundId, seq: nextSeq(rounds), topic: op.topic, plannedStart: null, plannedEnd: null, startedAt: null, endedAt: null,
            startedBy: null, endedBy: null, pointCount: 0, distanceM: 0, lastT: null, pending: true,
          });
        break;
      case "round.start": {
        const r = rounds.find((x) => x.id === op.roundId);
        if (r && r.startedAt == null) Object.assign(r, { startedAt: op.t, pending: true });
        break;
      }
      case "round.end": {
        const r = rounds.find((x) => x.id === op.roundId);
        if (r && r.endedAt == null) Object.assign(r, { endedAt: op.t, pending: true });
        break;
      }
      case "chunk": {
        const r = rounds.find((x) => x.id === op.roundId);
        if (r) Object.assign(r, { pointCount: r.pointCount + op.pts.length, pending: true });
        break;
      }
      case "cal.start":
        if (!cals.some((c) => c.id === op.calId))
          cals.push({
            id: op.calId, seq: nextSeq(cals), kind: op.kind, startedAt: op.t, endedAt: null, note: null,
            createdBy: null, createdAt: op.t, updatedAt: null, pending: true,
          });
        break;
      case "cal.end": {
        const c = cals.find((x) => x.id === op.calId);
        if (c && c.endedAt == null) Object.assign(c, { endedAt: op.t, pending: true });
        break;
      }
    }
  }
  return { ...s, rounds, calibrations: cals };
}
