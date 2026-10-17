// ประวัติงานทั้งหมด + ตัวกรอง + export สรุป
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { fmtKm } from "../../shared/geo";
import { CAL_LABEL, QC_LABEL, QC_STATUSES, can } from "../../shared/labels";
import { fmtClock, fmtThaiDate } from "../../shared/time";
import type { Master, Session, SessionList } from "../../shared/types";
import { api, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";
import { exportSummaryCsv } from "../lib/exporters";
import { CalBadge, ErrorBox, QcBadge } from "../components/ui";

const PAGE = 50;
const FILTER_KEYS = ["from", "to", "projectId", "driverId", "vehicleId", "qc", "cal", "q"] as const;

export default function Dashboard() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [master, setMaster] = useState<Master | null>(null);
  const [list, setList] = useState<Session[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const query = sp.toString();

  useEffect(() => {
    api<Master>("/master").then(setMaster).catch(() => {});
  }, []);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setErr("");
      try {
        const params = new URLSearchParams(query);
        params.set("limit", String(PAGE));
        params.set("offset", String(offset));
        const r = await api<SessionList>(`/sessions?${params}`);
        setList((old) => (offset ? [...old, ...r.sessions] : r.sessions));
        setHasMore(r.hasMore);
      } catch (e) {
        setErr(errMsg(e));
      } finally {
        setLoading(false);
      }
    },
    [query],
  );
  useEffect(() => {
    void load(0);
  }, [load]);

  function applyFilters(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = String(fd.get(k) ?? "").trim();
      if (v) next.set(k, v);
    }
    setSp(next);
  }

  const f = (k: string) => sp.get(k) ?? "";
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 721px)").matches;
  const activeFilters = FILTER_KEYS.filter((k) => sp.get(k)).length;
  return (
    <>
      <details className="card filter-box" open={wide || FILTER_KEYS.some((k) => sp.get(k))}>
      <summary>ตัวกรอง{activeFilters ? ` (${activeFilters})` : ""}</summary>
      <form className="filters" onSubmit={applyFilters} key={query}>
        <label className="field"><span>ตั้งแต่วันที่</span><input type="date" name="from" defaultValue={f("from")} /></label>
        <label className="field"><span>ถึงวันที่</span><input type="date" name="to" defaultValue={f("to")} /></label>
        <label className="field">
          <span>โปรเจกต์</span>
          <select name="projectId" defaultValue={f("projectId")}>
            <option value="">ทั้งหมด</option>
            {master?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (ปิดใช้งาน)"}</option>)}
          </select>
        </label>
        <label className="field">
          <span>คนขับ</span>
          <select name="driverId" defaultValue={f("driverId")}>
            <option value="">ทั้งหมด</option>
            {master?.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.active ? "" : " (ปิดใช้งาน)"}</option>)}
          </select>
        </label>
        <label className="field">
          <span>รถ</span>
          <select name="vehicleId" defaultValue={f("vehicleId")}>
            <option value="">ทั้งหมด</option>
            {master?.vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}{v.active ? "" : " (ปิดใช้งาน)"}</option>)}
          </select>
        </label>
        <label className="field">
          <span>สถานะ QC</span>
          <select name="qc" defaultValue={f("qc")}>
            <option value="">ทั้งหมด</option>
            {QC_STATUSES.map((k) => <option key={k} value={k}>{QC_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Calibration</span>
          <select name="cal" defaultValue={f("cal")}>
            <option value="">ทั้งหมด</option>
            <option value="ok">ครบ</option>
            <option value="missing">ยังไม่มี / ไม่ครบ</option>
          </select>
        </label>
        <label className="field full"><span>ค้นหาชื่องาน / หัวข้อรอบ / หมายเหตุ</span><input name="q" defaultValue={f("q")} /></label>
        <div className="row end">
          <button className="pri">กรอง</button>
          <button type="button" onClick={() => setSp(new URLSearchParams())}>ล้าง</button>
        </div>
      </form>
      </details>

      <div className="row between">
        <h2 className="m0">ประวัติงาน Mapping</h2>
        <div className="row">
          {user && can.record(user.role) && <Link className="btn pri" to="/sessions/new">+ งานใหม่</Link>}
          <button disabled={!list.length} onClick={() => exportSummaryCsv(list)}>Export สรุป (CSV)</button>
        </div>
      </div>

      <ErrorBox error={err} onRetry={() => void load(0)} />
      <div className="card table-wrap">
        <table className="cards-on-mobile">
          <thead>
            <tr>
              <th>วันที่</th><th>งาน</th><th>โปรเจกต์ / พื้นที่</th><th>คนขับ / ทีม</th><th>รถ / อุปกรณ์</th>
              <th>Calibration</th><th>รอบ (เวลาจริง)</th><th>ระยะทาง</th><th>QC</th>
            </tr>
          </thead>
          <tbody>
            {!loading && !list.length && (
              <tr><td colSpan={9} className="muted">ยังไม่มีข้อมูล{query ? "ตามตัวกรองนี้" : ""}</td></tr>
            )}
            {list.map((s) => (
              <tr key={s.id}>
                <td data-label="วันที่" className="nowrap">{fmtThaiDate(s.workDate)}</td>
                <td data-label="งาน">
                  <Link to={`/sessions/${s.id}`}><b>{s.title}</b></Link>
                  {user && can.record(user.role) && s.qcStatus !== "PASSED" && (
                    <div><Link className="small" to={`/record/${s.id}`}>บันทึก GPS →</Link></div>
                  )}
                </td>
                <td data-label="โปรเจกต์">{s.project.name}<div className="muted small">{s.project.area}</div></td>
                <td data-label="คนขับ">{s.driver.name}<div className="muted small">{s.driver.team}</div></td>
                <td data-label="รถ">{s.vehicle.plate}<div className="muted small">{s.vehicle.equipment}</div></td>
                <td data-label="Calibration">
                  {s.calibrations.length ? (
                    s.calibrations.map((c) => (
                      <div key={c.id} className="small nowrap">
                        {CAL_LABEL[c.kind]} {fmtClock(c.startedAt, s.workDate)}–{c.endedAt ? fmtClock(c.endedAt, s.workDate) : "…"}
                      </div>
                    ))
                  ) : (
                    <CalBadge cals={s.calibrations} />
                  )}
                </td>
                <td data-label="รอบ">
                  {s.rounds.map((r) => (
                    <div key={r.id} className="small">
                      {s.splitRounds ? `${r.seq}. ${r.topic}: ` : ""}
                      {!r.startedAt ? (
                        <span className="muted">ยังไม่เริ่ม</span>
                      ) : (
                        <>
                          {fmtClock(r.startedAt, s.workDate)}–
                          {r.endedAt ? fmtClock(r.endedAt, s.workDate) : <b className="live-text">กำลังวิ่ง</b>}
                        </>
                      )}
                    </div>
                  ))}
                </td>
                <td data-label="ระยะทาง" className="nowrap">{fmtKm(s.rounds.reduce((a, r) => a + r.distanceM, 0))}</td>
                <td data-label="QC"><QcBadge status={s.qcStatus} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="muted center pad">กำลังโหลด…</div>}
        {hasMore && !loading && (
          <div className="center pad"><button onClick={() => void load(list.length)}>โหลดเพิ่ม</button></div>
        )}
      </div>
    </>
  );
}
