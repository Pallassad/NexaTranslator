import { logWarn } from "../log";

export type UnavailableKind = "blocked" | "quota" | "credit" | "auth";

/**
 * Engine không dùng tiếp được (bị chặn, hết quota, hết credit, sai key...).
 * Tool bắt lỗi này để dừng đúng cách / hỏi người dùng chuyển engine.
 */
export class EngineUnavailable extends Error {
  constructor(public engine: string, public reason: string, public kind: UnavailableKind = "blocked") {
    super(`${engine}: ${reason}`);
  }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export type StatusKind = "quota" | "credit" | "auth" | null;

const KIND_TEXT: Record<Exclude<StatusKind, null>, string> = {
  auth: "Key không hợp lệ hoặc không có quyền",
  quota: "Hết quota",
  credit: "Tài khoản đã hết credit – hãy nạp thêm rồi chạy lại cùng lệnh để dịch tiếp",
};

/**
 * Gọi fetch kèm thử lại khi gặp 429 / 5xx / lỗi mạng.
 * - classify(status, body) = "quota" | "credit" | "auth" → ném EngineUnavailable ngay, không thử lại.
 * - Lỗi 4xx khác → ném Error thường (request sai, cần sửa code).
 * - Hết lượt thử → ném EngineUnavailable("blocked").
 */
export async function fetchWithRetry(
  engine: string,
  url: string,
  init: RequestInit,
  opt: { retries?: number; classify?: (status: number, body: string) => StatusKind } = {},
): Promise<Response> {
  const retries = opt.retries ?? 4;
  let wait = 2000;

  for (let attempt = 1; ; attempt++) {
    let res: Response | undefined;
    let problem: string;

    try {
      res = await fetch(url, init);
    } catch {
      res = undefined;
    }

    if (res && !res.ok && res.status !== 429 && res.status < 500) {
      const body = await res.text();
      const kind = opt.classify?.(res.status, body) ?? (res.status === 401 || res.status === 403 ? "auth" : null);
      if (kind) throw new EngineUnavailable(engine, `${KIND_TEXT[kind]} (HTTP ${res.status})`, kind);
      throw new Error(`${engine}: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    if (res?.ok) return res;
    problem = res ? `HTTP ${res.status}` : "lỗi mạng";

    if (attempt >= retries) throw new EngineUnavailable(engine, `${problem} sau ${attempt} lần thử`, "blocked");
    const ra = Number(res?.headers.get("retry-after"));
    const delay = ra > 0 ? Math.min(ra * 1000, 60_000) : wait;
    logWarn(`⚠ ${engine}: ${problem} – thử lại sau ${Math.round(delay / 1000)}s...`);
    await sleep(delay);
    wait *= 2;
  }
}
