// เรียก API ของ Worker พร้อมแปลงข้อผิดพลาดเป็นข้อความภาษาไทย
export class ApiError extends Error {
  status: number;
  code?: string;
  data?: unknown;
  constructor(message: string, status: number, code?: string, data?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/** status 0 = เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (ออฟไลน์) */
export const isOffline = (e: unknown) => e instanceof ApiError && e.status === 0;
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (อาจไม่มีสัญญาณอินเทอร์เน็ต)", 0, "offline");
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  const data: unknown = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");
  if (!res.ok) {
    const obj = data && typeof data === "object" ? (data as { error?: string; code?: string }) : {};
    const code = obj.code;
    if (res.status === 401 || code === "must_change_password") {
      window.dispatchEvent(new CustomEvent("mlog:auth", { detail: code ?? "unauthorized" }));
    }
    throw new ApiError(obj.error ?? `เกิดข้อผิดพลาด (${res.status})`, res.status, code, data);
  }
  return data as T;
}
