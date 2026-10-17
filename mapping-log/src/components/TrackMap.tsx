import { useEffect, useRef } from "react";
import L from "leaflet";

export type MapTrack = { id: string; label: string; color: string; points: [number, number][]; version?: number };
export const COLORS = ["#1f6feb", "#d1242f", "#1a7f37", "#8250df", "#bf8700", "#0a7ea4", "#cf222e", "#57606a"];

type Props = {
  tracks: MapTrack[];
  marker?: [number, number] | null;
  /** เลื่อนแผนที่ตามตำแหน่ง marker (หน้าบันทึก) */
  follow?: boolean;
  /** เปลี่ยนค่านี้เมื่อต้องการซูมให้เห็นเส้นทางทั้งหมดใหม่ */
  fitKey?: string;
  height?: number | string;
};

export default function TrackMap({ tracks, marker, follow, fitKey, height = 480 }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lines = useRef(new Map<string, { line: L.Polyline; start: L.CircleMarker }>());
  const markerRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    const map = L.map(el.current!, { preferCanvas: true }).setView([13.7563, 100.5018], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current!);
    const linesMap = lines.current;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      linesMap.clear();
      markerRef.current = null;
    };
  }, []);

  // วาดเส้นทาง (อัปเดตเฉพาะที่เปลี่ยน)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const t of tracks) {
      seen.add(t.id);
      let item = lines.current.get(t.id);
      if (!item) {
        const line = L.polyline([], { color: t.color, weight: 5, opacity: 0.85 }).addTo(map);
        line.bindTooltip(t.label, { sticky: true });
        const start = L.circleMarker([0, 0], { radius: 5, color: t.color, fillColor: "#fff", fillOpacity: 1, weight: 3 });
        start.bindTooltip(`${t.label} — จุดเริ่ม`);
        item = { line, start };
        lines.current.set(t.id, item);
      }
      item.line.setLatLngs(t.points);
      item.line.setStyle({ color: t.color });
      item.line.setTooltipContent(t.label);
      if (t.points.length) {
        item.start.setLatLng(t.points[0]).setStyle({ color: t.color });
        if (!map.hasLayer(item.start)) item.start.addTo(map);
      } else if (map.hasLayer(item.start)) item.start.remove();
    }
    for (const [id, item] of lines.current) {
      if (!seen.has(id)) {
        item.line.remove();
        item.start.remove();
        lines.current.delete(id);
      }
    }
  }, [tracks]);

  // ซูมให้เห็นทั้งหมด
  useEffect(() => {
    const map = mapRef.current;
    if (!map || follow) return;
    const all = tracks.flatMap((t) => t.points);
    if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [30, 30], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // จุดตำแหน่งปัจจุบัน / จุดเล่นย้อนหลัง
  const mLat = marker?.[0];
  const mLng = marker?.[1];
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mLat == null || mLng == null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = L.circleMarker([mLat, mLng], { radius: 9, color: "#fff", weight: 3, fillColor: "#d1242f", fillOpacity: 1 }).addTo(map);
    } else markerRef.current.setLatLng([mLat, mLng]);
    if (follow) map.setView([mLat, mLng], Math.max(map.getZoom(), 16), { animate: false });
  }, [mLat, mLng, follow]);

  return <div ref={el} className="map" style={{ height }} />;
}
