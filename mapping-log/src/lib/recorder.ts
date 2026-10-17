// ตัวบันทึก GPS ระดับแอป: บันทึกต่อเนื่องแม้สลับไปหน้าอื่นในแอป และทำต่อได้หลังรีเฟรชหน้า
import { haversine, pathDistance } from "../../shared/geo";
import type { CalKind } from "../../shared/labels";
import { api } from "./api";
import { addPoint, enqueue, pendingOps } from "./outbox";
import { createStore, lsGet, lsSet, newId } from "./store";
import { decodeTrack, mergeByTime, pendingPoints, type TrackResponse } from "./track";

export const MAX_ACCURACY_M = 50; // ไม่บันทึกจุดที่คลาดเคลื่อนเกิน 50 ม.
const MIN_MOVE_M = 3; // จอดนิ่ง: ไม่บันทึกจุดที่ขยับไม่ถึง 3 ม.
const MAX_GAP_MS = 15_000; // ...แต่บันทึกอย่างน้อยทุก 15 วินาที

const K_ACTIVE = "mlog:active";
const K_CAL = "mlog:cal";
const K_LAST = "mlog:last"; // จุดล่าสุดที่บันทึก (กันจุดซ้ำหลังรีเฟรชหน้า)

export type ActiveRound = { sessionId: string; roundId: string; startedAt: number; label: string };
export type ActiveCal = { sessionId: string; calId: string; kind: CalKind; startedAt: number };
export type Fix = { lat: number; lng: number; acc: number; spd: number | null; hdg: number | null; alt: number | null; t: number };

type RecState = {
  active: ActiveRound | null;
  cal: ActiveCal | null;
  pos: Fix | null;
  gpsError: string | null;
  watching: boolean;
  wakeLock: boolean;
  dist: number;
  count: number;
  speed: number | null;
  trackVersion: number;
};

export const recStore = createStore<RecState>({
  active: lsGet<ActiveRound | null>(K_ACTIVE, null),
  cal: lsGet<ActiveCal | null>(K_CAL, null),
  pos: null,
  gpsError: null,
  watching: false,
  wakeLock: false,
  dist: 0,
  count: 0,
  speed: null,
  trackVersion: 0,
});

/** เส้นทางของรอบที่กำลังบันทึก (array เดียวแก้ไขในที่ เพื่อไม่ต้องคัดลอกทุกวินาที) */
export const liveTrack: [number, number][] = [];
type Last = { roundId: string; t: number; lat: number; lng: number };
let last: Last | null = null;
function setLast(v: Last | null) {
  last = v;
  lsSet(K_LAST, v);
}
let watchId: number | null = null;
let viewers = 0;
let wake: WakeLockSentinel | null = null;

function onFix(p: GeolocationPosition) {
  const c = p.coords;
  const t = p.timestamp || Date.now();
  const fix: Fix = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, spd: c.speed, hdg: c.heading, alt: c.altitude, t };
  const s = recStore.get();
  const patch: Partial<RecState> = { pos: fix, gpsError: null };
  const a = s.active;
  // บันทึกเฉพาะจุดที่แม่นพอ ใหม่กว่าจุดล่าสุด และไม่ใช่ตำแหน่งเก่าจากก่อนเริ่มรอบ
  if (a && c.accuracy <= MAX_ACCURACY_M && t >= a.startedAt - 5_000 && (!last || t > last.t)) {
    const d = last ? haversine(last.lat, last.lng, fix.lat, fix.lng) : 0;
    if (!last || d >= MIN_MOVE_M || t - last.t >= MAX_GAP_MS) {
      addPoint(a.sessionId, a.roundId, t, [fix.lat, fix.lng, c.accuracy, c.speed, c.heading, c.altitude]);
      liveTrack.push([fix.lat, fix.lng]);
      patch.speed = c.speed ?? (last ? d / Math.max(1, (t - last.t) / 1000) : null);
      patch.dist = s.dist + d;
      patch.count = s.count + 1;
      patch.trackVersion = s.trackVersion + 1;
      setLast({ roundId: a.roundId, t, lat: fix.lat, lng: fix.lng });
    }
  }
  recStore.set(patch);
}

function onError(e: GeolocationPositionError) {
  const msg =
    e.code === 1
      ? "ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — กรุณาอนุญาต Location ให้เว็บนี้ในการตั้งค่าเบราว์เซอร์"
      : e.code === 2
        ? "หาตำแหน่งไม่ได้ (สัญญาณ GPS อ่อน)"
        : "รอสัญญาณ GPS นานเกินไป กำลังลองใหม่…";
  recStore.set({ gpsError: window.isSecureContext ? msg : `${msg} (ต้องเปิดเว็บผ่าน HTTPS)` });
}

function ensureWatch() {
  const need = viewers > 0 || !!recStore.get().active;
  if (need && watchId == null) {
    if (!("geolocation" in navigator)) {
      recStore.set({ gpsError: "อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับ GPS" });
      return;
    }
    watchId = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
    recStore.set({ watching: true });
  } else if (!need && watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    recStore.set({ watching: false, pos: null });
  }
  void syncWakeLock();
}

/** กันหน้าจอดับระหว่างบันทึก (ต้องขอใหม่ทุกครั้งที่กลับมาที่หน้า) */
async function syncWakeLock() {
  const s = recStore.get();
  const need = !!(s.active || s.cal) && document.visibilityState === "visible";
  if (need && !wake && "wakeLock" in navigator) {
    try {
      wake = await navigator.wakeLock.request("screen");
      wake.addEventListener("release", () => {
        wake = null;
        recStore.set({ wakeLock: false });
      });
      recStore.set({ wakeLock: true });
    } catch {
      /* บางเบราว์เซอร์ไม่รองรับ */
    }
  } else if (!need && wake) {
    await wake.release().catch(() => {});
    wake = null;
  }
}

function resetLive() {
  liveTrack.length = 0;
  setLast(null);
  recStore.set({ dist: 0, count: 0, speed: null, trackVersion: recStore.get().trackVersion + 1 });
}

/** ประกอบเส้นทางของรอบที่ค้างอยู่ใหม่ หลังรีเฟรชหน้า (จากเซิร์ฟเวอร์ + จุดที่ยังไม่ได้ส่ง) */
async function rebuildTrack() {
  const a = recStore.get().active;
  if (!a) return;
  let server: ReturnType<typeof pendingPoints> = [];
  try {
    const res = await api<TrackResponse>(`/sessions/${a.sessionId}/track?round=${a.roundId}`);
    server = decodeTrack(res)[a.roundId] ?? [];
  } catch {
    /* ออฟไลน์: ใช้เฉพาะจุดในเครื่อง */
  }
  if (recStore.get().active?.roundId !== a.roundId) return;
  const all = mergeByTime(server, pendingPoints(pendingOps(a.sessionId), a.roundId));
  liveTrack.length = 0;
  for (const p of all) liveTrack.push([p.lat, p.lng]);
  const lp = all[all.length - 1];
  if (lp && (!last || lp.t > last.t)) setLast({ roundId: a.roundId, t: lp.t, lat: lp.lat, lng: lp.lng });
  recStore.set({ dist: pathDistance(all), count: all.length, trackVersion: recStore.get().trackVersion + 1 });
}

export const recorder = {
  init() {
    document.addEventListener("visibilitychange", () => void syncWakeLock());
    const a = recStore.get().active;
    if (a) {
      // ใช้จุดล่าสุดที่จำไว้ทันที ก่อนเปิด GPS (เครื่องอาจส่งตำแหน่งเดิมซ้ำมาเป็นจุดแรก)
      const l = lsGet<Last | null>(K_LAST, null);
      last = l && l.roundId === a.roundId ? l : null;
      void rebuildTrack();
      ensureWatch();
    }
  },

  /** หน้าบันทึกเปิดอยู่: เปิด GPS เพื่อแสดงตำแหน่ง (คืนฟังก์ชันสำหรับปิด) */
  attachView(): () => void {
    viewers++;
    ensureWatch();
    return () => {
      viewers--;
      ensureWatch();
    };
  },

  startRound(sessionId: string, roundId: string, label: string) {
    const t = Date.now();
    enqueue({ k: "round.start", sessionId, roundId, t });
    const active: ActiveRound = { sessionId, roundId, startedAt: t, label };
    lsSet(K_ACTIVE, active);
    resetLive();
    recStore.set({ active });
    ensureWatch();
  },

  /** ทำต่อรอบที่เริ่มไว้แล้ว (เช่น เริ่มจากเครื่องอื่น หรือข้อมูลในเครื่องหาย) */
  resumeRound(sessionId: string, roundId: string, startedAt: number, label: string) {
    const active: ActiveRound = { sessionId, roundId, startedAt, label };
    lsSet(K_ACTIVE, active);
    resetLive();
    recStore.set({ active });
    void rebuildTrack();
    ensureWatch();
  },

  endRound() {
    const a = recStore.get().active;
    if (!a) return;
    enqueue({ k: "round.end", sessionId: a.sessionId, roundId: a.roundId, t: Date.now() });
    lsSet(K_ACTIVE, null);
    setLast(null);
    recStore.set({ active: null });
    ensureWatch();
  },

  addRound(sessionId: string, topic: string): string {
    const roundId = newId();
    enqueue({ k: "round.add", sessionId, roundId, topic });
    return roundId;
  },

  startCal(sessionId: string, kind: CalKind) {
    const cal: ActiveCal = { sessionId, calId: newId(), kind, startedAt: Date.now() };
    enqueue({ k: "cal.start", sessionId, calId: cal.calId, kind, t: cal.startedAt });
    lsSet(K_CAL, cal);
    recStore.set({ cal });
    void syncWakeLock();
  },

  /** ล้างสถานะ Calibration ในเครื่อง เมื่อรายการนั้นถูกปิด/ลบจากที่อื่นแล้ว */
  forgetCal(calId: string) {
    if (recStore.get().cal?.calId !== calId) return;
    lsSet(K_CAL, null);
    recStore.set({ cal: null });
    void syncWakeLock();
  },

  /** กดเสร็จสิ้น Calibration (ใช้ได้ทั้งรายการที่เริ่มในเครื่องนี้และรายการที่ยังไม่เสร็จจากที่อื่น) */
  endCal(sessionId: string, calId: string) {
    enqueue({ k: "cal.end", sessionId, calId, t: Date.now() });
    if (recStore.get().cal?.calId === calId) {
      lsSet(K_CAL, null);
      recStore.set({ cal: null });
    }
    void syncWakeLock();
  },
};
