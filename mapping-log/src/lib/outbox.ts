// คิวข้อมูลรอส่ง (outbox): ทุกการกระทำในภาคสนามเก็บลงเครื่องก่อน แล้วค่อยส่งขึ้นเซิร์ฟเวอร์
// ถ้าเน็ตหลุด ข้อมูลยังอยู่ในเครื่อง และส่งซ้ำอัตโนมัติโดยไม่เกิดข้อมูลซ้ำ
import { CHUNK_MAX_POINTS, SYNC_MAX_OPS, type PtArr, type SyncOp, type SyncResult } from "../../shared/types";
import { ApiError, api } from "./api";
import { createStore, lsGet, lsSet, newId } from "./store";

const K_OUT = "mlog:outbox";
const K_OPEN = "mlog:open";
const K_FAILED = "mlog:failed";
const BASE_DELAY = 10_000;
const MAX_DELAY = 120_000;

type OpenChunk = { id: string; sessionId: string; roundId: string; t0: number; pts: PtArr[] };
export type FailedOp = { k: string; sessionId: string; error: string; at: number; points?: number };

type SyncState = {
  pending: number;
  syncing: boolean;
  lastOkAt: number | null;
  lastError: string | null;
  authError: boolean;
  storageError: boolean;
  failed: FailedOp[];
};

let ops: SyncOp[] = lsGet<SyncOp[]>(K_OUT, []);
let open: OpenChunk | null = lsGet<OpenChunk | null>(K_OPEN, null);

export const syncStore = createStore<SyncState>({
  pending: ops.length + (open?.pts.length ? 1 : 0),
  syncing: false,
  lastOkAt: null,
  lastError: null,
  authError: false,
  storageError: false,
  failed: lsGet<FailedOp[]>(K_FAILED, []),
});

/** แจ้งหน้าจอเมื่อส่งข้อมูลสำเร็จ (detail = รายการ sessionId ที่เกี่ยวข้อง) */
export const syncEvents = new EventTarget();

function counts() {
  return { pending: ops.length + (open?.pts.length ? 1 : 0) };
}

function persist() {
  const ok = lsSet(K_OUT, ops) && lsSet(K_OPEN, open);
  syncStore.set({ ...counts(), storageError: !ok });
}

/** ปิดก้อนพิกัดปัจจุบันแล้วย้ายเข้าคิว */
function sealOpen() {
  if (open && open.pts.length) {
    ops.push({ id: open.id, sessionId: open.sessionId, k: "chunk", roundId: open.roundId, t0: open.t0, pts: open.pts });
  }
  open = null;
}

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewOp = DistOmit<SyncOp, "id">;

/** เพิ่มรายการเข้าคิว (เรียงลำดับเสมอ: พิกัดที่ค้างจะถูกปิดก้อนก่อน) */
export function enqueue(op: NewOp) {
  sealOpen();
  ops.push({ ...op, id: newId() } as SyncOp);
  persist();
  void syncNow();
}

/** เพิ่มจุด GPS 1 จุด ([lat, lng, acc, speed, heading, alt]) */
export function addPoint(sessionId: string, roundId: string, t: number, v: [number, number, number | null, number | null, number | null, number | null]) {
  if (open && (open.roundId !== roundId || open.pts.length >= CHUNK_MAX_POINTS)) {
    sealOpen();
    lsSet(K_OUT, ops);
  }
  if (!open) open = { id: newId(), sessionId, roundId, t0: t, pts: [] };
  open.pts.push([t - open.t0, ...v]);
  const ok = lsSet(K_OPEN, open);
  syncStore.set({ ...counts(), storageError: !ok });
}

/** รายการที่ยังไม่ได้ส่ง (รวมก้อนพิกัดที่กำลังเก็บ) */
export function pendingOps(sessionId?: string): SyncOp[] {
  const all: SyncOp[] = open?.pts.length
    ? [...ops, { id: open.id, sessionId: open.sessionId, k: "chunk", roundId: open.roundId, t0: open.t0, pts: open.pts }]
    : [...ops];
  return sessionId ? all.filter((o) => o.sessionId === sessionId) : all;
}

let syncing = false;
let delay = BASE_DELAY;
let timer: ReturnType<typeof setTimeout> | undefined;

export async function syncNow(): Promise<void> {
  if (syncing) return;
  syncing = true;
  syncStore.set({ syncing: true });
  const touched = new Set<string>();
  try {
    if (open?.pts.length && navigator.onLine !== false) {
      sealOpen();
      persist();
    }
    while (ops.length) {
      const batch = ops.slice(0, SYNC_MAX_OPS);
      let res: { results: SyncResult[] };
      try {
        res = await api<{ results: SyncResult[] }>("/sync", { body: { ops: batch } });
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(String(e), 0);
        if (err.status === 401 || err.code === "must_change_password") {
          syncStore.set({ authError: true, lastError: "กรุณาเข้าสู่ระบบใหม่ เพื่อส่งข้อมูลที่ค้างอยู่ในเครื่อง" });
        } else {
          syncStore.set({ lastError: err.status === 0 ? "ออฟไลน์ — เก็บข้อมูลไว้ในเครื่องก่อน จะส่งอัตโนมัติเมื่อมีสัญญาณ" : err.message });
          delay = Math.min(delay * 2, MAX_DELAY);
        }
        break;
      }
      const byId = new Map(res.results.map((r) => [r.id, r]));
      const sent = new Set(batch.map((o) => o.id));
      const failedNow: FailedOp[] = [];
      for (const op of batch) {
        touched.add(op.sessionId);
        const r = byId.get(op.id);
        if (r && !r.ok)
          failedNow.push({ k: op.k, sessionId: op.sessionId, error: r.error ?? "ไม่ทราบสาเหตุ", at: Date.now(), points: op.k === "chunk" ? op.pts.length : undefined });
      }
      ops = ops.filter((o) => !sent.has(o.id));
      if (failedNow.length) {
        const failed = [...failedNow, ...syncStore.get().failed].slice(0, 50);
        lsSet(K_FAILED, failed);
        syncStore.set({ failed });
      }
      persist();
      delay = BASE_DELAY;
      syncStore.set({ lastOkAt: Date.now(), lastError: null, authError: false });
    }
  } finally {
    syncing = false;
    syncStore.set({ syncing: false });
    if (touched.size) syncEvents.dispatchEvent(new CustomEvent("synced", { detail: [...touched] }));
  }
}

export function clearFailed() {
  lsSet(K_FAILED, null);
  syncStore.set({ failed: [] });
}

export function startSyncLoop() {
  const tick = async () => {
    await syncNow();
    timer = setTimeout(tick, ops.length || open?.pts.length ? delay : 30_000);
  };
  const kick = () => {
    delay = BASE_DELAY;
    void syncNow();
  };
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && kick());
  if (timer) clearTimeout(timer);
  void tick();
}
