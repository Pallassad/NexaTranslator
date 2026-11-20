import type { TranslationProvider } from "./types";
import { EngineUnavailable } from "./errors";
import { logWarn } from "../log";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Lỗi do Google chặn (429/403) – nên đổi sang endpoint khác. */
class BlockedError extends Error {}

/**
 * Một cách gọi Google Dịch miễn phí.
 * translate(texts) dịch một nhóm câu và trả về đúng số câu.
 */
interface Endpoint {
  name: string;
  /** Chia danh sách câu thành các nhóm vừa với giới hạn của endpoint. */
  chunk(texts: string[]): string[][];
  translate(texts: string[], from: string, to: string): Promise<string[]>;
}

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": "Mozilla/5.0", ...(init?.headers ?? {}) },
  });
  if (res.status === 429 || res.status === 403) throw new BlockedError(`HTTP ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Chia nhóm theo tổng độ dài (sau khi mã hóa URL). */
function chunkBy(texts: string[], limit: number, cost: (t: string) => number): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const t of texts) {
    const c = cost(t);
    if (cur.length && len + c > limit) { out.push(cur); cur = []; len = 0; }
    cur.push(t);
    len += c;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Endpoint của tiện ích Chrome: hỗ trợ nhiều tham số q trong 1 request. */
const dictChrome: Endpoint = {
  name: "dict-chrome-ex",
  chunk: texts => chunkBy(texts, 3500, t => encodeURIComponent(t).length + 3),
  async translate(texts, from, to) {
    const qs = texts.map(t => "q=" + encodeURIComponent(t)).join("&");
    const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${from}&tl=${to}&${qs}`;
    const data = await getJson(url);
    // Trả về ["a","b"] hoặc [["a","en"],["b","en"]] tùy sl=auto hay không
    const arr: any[] = Array.isArray(data) ? data : [data];
    const out = arr.map(x => (Array.isArray(x) ? x[0] : x)).map(String);
    if (out.length !== texts.length) throw new Error("Sai số câu trả về");
    return out;
  },
};

/** Endpoint gtx dạng GET: gộp câu bằng xuống dòng. */
function gtx(method: "GET" | "POST"): Endpoint {
  return {
    name: `gtx-${method.toLowerCase()}`,
    chunk: texts => chunkBy(texts, method === "GET" ? 3500 : 4500, t => encodeURIComponent(t).length + 3),
    async translate(texts, from, to) {
      const base = `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${from}&tl=${to}`;
      const q = texts.join("\n");
      const data = method === "GET"
        ? await getJson(`${base}&q=${encodeURIComponent(q)}`)
        : await getJson(base, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: new URLSearchParams({ q }),
          });
      const joined = (data[0] as any[]).map(s => s[0] ?? "").join("");
      const parts = joined.split("\n");
      if (parts.length !== texts.length) throw new Error("Sai số câu trả về");
      return parts;
    },
  };
}

const ENDPOINTS: Endpoint[] = [dictChrome, gtx("GET"), gtx("POST")];

export interface GoogleOptions {
  delayMs?: number;
  /** Số lần thử lại trên MỖI endpoint trước khi đổi sang endpoint khác. */
  retries?: number;
}

/**
 * Google Dịch miễn phí (không chính thức).
 * Thử lần lượt nhiều endpoint: endpoint nào bị chặn thì chuyển sang cái tiếp theo.
 */
export class GoogleFreeProvider implements TranslationProvider {
  name = "Google (Free)";
  private current = 0;
  private delayMs: number;
  private retries: number;

  constructor(opt: GoogleOptions = {}) {
    this.delayMs = opt.delayMs ?? 500;
    this.retries = opt.retries ?? 3;
  }

  /** Dịch 1 nhóm, tự thử lại / đổi endpoint khi lỗi. */
  private async translateGroup(texts: string[], from: string, to: string): Promise<string[]> {
    for (let ep = this.current; ep < ENDPOINTS.length; ep++) {
      const endpoint = ENDPOINTS[ep];
      let wait = 3000;
      for (let attempt = 1; attempt <= this.retries; attempt++) {
        try {
          const r = await endpoint.translate(texts, from, to);
          this.current = ep; // nhớ endpoint đang chạy tốt
          return r;
        } catch (e: any) {
          if (e instanceof BlockedError) {
            if (attempt === this.retries) break;
            logWarn(`⚠ ${endpoint.name}: ${e.message} – thử lại sau ${wait / 1000}s...`);
            await sleep(wait);
            wait *= 3;
          } else if (texts.length > 1) {
            // Lỗi định dạng (sai số câu...) → chia đôi nhóm rồi dịch lại
            const mid = Math.ceil(texts.length / 2);
            return [
              ...(await this.translateGroup(texts.slice(0, mid), from, to)),
              ...(await this.translateGroup(texts.slice(mid), from, to)),
            ];
          } else {
            if (attempt === this.retries) break;
            await sleep(wait);
          }
        }
      }
      if (ep + 1 < ENDPOINTS.length) logWarn(`↪ Chuyển sang cách gọi khác: ${ENDPOINTS[ep + 1].name}`);
    }
    // Báo cho chuỗi dự phòng biết để chuyển engine khác
    throw new EngineUnavailable(this.name, "bị chặn ở tất cả cách gọi (IP đang bị giới hạn tạm thời)");
  }

  async translateBatch(texts: string[], from: string, to: string): Promise<string[]> {
    const out: string[] = [];
    for (const group of ENDPOINTS[this.current].chunk(texts)) {
      out.push(...(await this.translateGroup(group, from, to)));
      await sleep(this.delayMs);
    }
    return out;
  }
}

/** Kiểm tra nhanh từng endpoint có dùng được không. */
export async function checkGoogle(): Promise<{ endpoint: string; result: string }[]> {
  const rows = [];
  for (const ep of ENDPOINTS) {
    try {
      const r = await ep.translate(["Hello, how are you?"], "en", "vi");
      rows.push({ endpoint: ep.name, result: `✅ ${r[0]}` });
    } catch (e: any) {
      rows.push({ endpoint: ep.name, result: `❌ ${e.message}` });
    }
  }
  return rows;
}

/**
 * Lấy CÁCH ĐỌC (phiên âm Latin) của chữ gốc – dùng cho tên nhân vật tiếng Nhật có kanji: 佐藤 → "Satō".
 * Gọi gtx với dt=rm (miễn phí). Không phải bản dịch nghĩa.
 * Cấu trúc trả về: data[0] = các đoạn; đoạn phiên âm có dạng [null, null, <phiên âm đích>, <phiên âm gốc>].
 */
export function parseReading(data: unknown): string | undefined {
  const parts = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as unknown[]) : [];
  for (const p of parts) {
    if (Array.isArray(p) && p[0] == null && p[1] == null && typeof p[3] === "string" && p[3].trim()) return p[3].trim();
  }
  return undefined;
}

export async function googleReading(text: string, from = "ja"): Promise<string | undefined> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=en&dt=t&dt=rm&q=${encodeURIComponent(text)}`;
  try {
    return parseReading(await getJson(url));
  } catch (e) {
    if (e instanceof BlockedError) throw new Error("Google đang chặn tạm thời, thử lại sau ít phút");
    throw e;
  }
}
