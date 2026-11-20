import type { Pricing } from "./providers/types";

/**
 * Ước tính THÔ chi phí / thời gian – chỉ để người dùng hình dung trước khi dịch.
 * Số thật phụ thuộc mạng, giới hạn tốc độ, và việc AI "suy nghĩ" nhiều hay ít.
 */

/** ~3,5 ký tự / token với tiếng Anh; tiếng Việt tốn token hơn. */
const CHARS_PER_TOKEN = 3.5;
const PROMPT_TOKENS_PER_BATCH = 300;

export interface Range { low: number; high: number; }

export function estimateCost(chars: number, count: number, pricing: Pricing, batchSize = 30): Range {
  const batches = Math.ceil(count / batchSize);
  const input = chars / CHARS_PER_TOKEN + batches * PROMPT_TOKENS_PER_BATCH;
  const output = (chars / CHARS_PER_TOKEN) * 1.6; // bản dịch tiếng Việt dài & tốn token hơn
  const base = (input * pricing.input + output * pricing.output) / 1_000_000;
  // Cận trên ×2,5 cho phần AI tự suy nghĩ, chia đôi lô khi lỗi...
  return { low: base, high: base * 2.5 };
}

/** Thời gian (phút). */
export function estimateMinutes(kind: "google" | "ai", chars: number, count: number, batchSize = 30): Range {
  if (kind === "google") {
    const requests = Math.ceil(chars / 3000);
    return { low: (requests * 1.2) / 60, high: (requests * 3) / 60 };
  }
  const batches = Math.ceil(count / batchSize);
  return { low: (batches * 5) / 60, high: (batches * 15) / 60 };
}

export const fmtUsd = (r: Range) =>
  r.high < 0.01 ? "< $0,01" : `~$${fmtNum(r.low, 2)}–${fmtNum(r.high, 2)}`;

export const fmtMinutes = (r: Range) => {
  const f = (m: number) => (m < 1 ? "<1 phút" : m < 90 ? `${Math.round(m)} phút` : `${fmtNum(m / 60, 1)} giờ`);
  const lo = f(r.low), hi = f(r.high);
  return lo === hi ? `~${lo}` : `~${lo} – ${hi}`;
};

export const fmtNum = (n: number, digits = 0) =>
  n.toLocaleString("vi-VN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "12 phút 30 giây" */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h} giờ ${m} phút`;
  if (m) return `${m} phút ${sec} giây`;
  return `${sec} giây`;
}
