import { join } from "node:path";
import { existsSync } from "node:fs";
import { readJson, writeJson } from "../core/writer";
import { restore } from "../core/protect";
import type { Unit } from "../core/units";
import type { AppContext } from "./context";
import type { GameSession } from "./session";
import type { TranslationPlan } from "./plan";
import { offerPaid, setupEngines } from "./engines";

/**
 * Xem lại các DÒNG LỖI: bản dịch máy làm hỏng mã điều khiển (mất \C[2], lặp \N[1]...)
 * → tool đã giữ bản gốc cho cả đoạn. Ở đây người dùng có thể:
 *   - tự gõ bản dịch (kiểm tra đủ mã trước khi lưu),
 *   - nhờ AI dịch lại (hỏi trước khi tốn phí),
 *   - đánh dấu "giữ bản gốc" (ẩn khỏi danh sách, game vẫn hiện chữ gốc).
 * Bản dịch sửa tay được lưu vào memory → lần dịch sau dùng luôn, không bị dịch đè.
 */

export interface ErrorSegment {
  /** Câu đã bảo vệ mã: "The {0}Old Bridge{1} is north." – cũng là khóa trong memory. */
  text: string;
  /** Mã thật ứng với {0}, {1}...: ["\\C[2]", "\\C[0]"]. */
  tokens: string[];
  /** Bản dịch máy đang có trong memory (bị hỏng mã). */
  translation: string;
  /** Lỗi của riêng câu này (null = câu này ổn, lỗi nằm ở câu khác cùng đoạn). */
  reason: string | null;
}

export interface ErrorItem {
  /** Khóa đoạn: file + vị trí dòng đầu (ổn định giữa các lần mở). */
  key: string;
  file: string;
  kind: string;
  /** Chữ gốc của cả đoạn (các dòng nối bằng xuống dòng). */
  source: string;
  /** Số dòng trong game của đoạn này. */
  lines: number;
  reason: string;
  segments: ErrorSegment[];
}

const unitKey = (u: Unit) => `${u.entries[0].file}#${u.entries[0].path.join(".")}`;

// ---------------------------------------------------------------- review.json: đoạn đã chọn "giữ bản gốc"
interface ReviewFile { kept: Record<string, number> }
const reviewPath = (s: GameSession) => join(s.paths.projDir, "review.json");

function loadReview(s: GameSession): ReviewFile {
  const p = reviewPath(s);
  if (!existsSync(p)) return { kept: {} };
  try { return { kept: (readJson(p) as ReviewFile).kept ?? {} }; } catch { return { kept: {} }; }
}

/** Số dòng lỗi đã được người dùng chọn giữ bản gốc (để trừ khỏi số "cần xem lại"). */
export function reviewedLines(s: GameSession): number {
  return Object.values(loadReview(s).kept).reduce((n, x) => n + x, 0);
}

// ---------------------------------------------------------------- liệt kê
function errorUnits(plan: TranslationPlan): { unit: Unit; translations: string[]; reason: string }[] {
  const out = [];
  for (const u of plan.units) {
    const translations = u.segments.map(s => plan.tm.get(s.text, plan.from, plan.to));
    if (translations.some(t => t === undefined)) continue;        // chưa dịch – không phải lỗi
    const reason = u.assemble(translations as string[]);
    if (reason) out.push({ unit: u, translations: translations as string[], reason });
  }
  return out;
}

/** Danh sách dòng lỗi chưa xử lý (bỏ các đoạn đã chọn giữ bản gốc). */
export function listErrors(session: GameSession, plan: TranslationPlan): ErrorItem[] {
  const kept = loadReview(session).kept;
  return errorUnits(plan)
    .filter(x => !(unitKey(x.unit) in kept))
    .map(({ unit, translations, reason }) => ({
      key: unitKey(unit),
      file: unit.entries[0].file,
      kind: unit.entries[0].kind,
      source: unit.entries.map(e => e.source).join("\n"),
      lines: unit.entries.length,
      reason,
      segments: unit.segments.map((s, i) => {
        const r = restore(translations[i], s.tokens);
        return { text: s.text, tokens: s.tokens, translation: translations[i], reason: r.ok ? null : r.reason };
      }),
    }));
}

function findUnit(plan: TranslationPlan, key: string): Unit {
  const u = plan.units.find(x => unitKey(x) === key);
  if (!u) throw new Error("Không tìm thấy đoạn này nữa (game hoặc glossary đã thay đổi). Mở lại danh sách lỗi.");
  return u;
}

// ---------------------------------------------------------------- sửa
/**
 * Lưu bản dịch người dùng gõ cho từng câu của đoạn.
 * Kiểm tra trước: mỗi mã {n} phải có đúng 1 lần, và cả đoạn ghép được → mới ghi vào memory.
 */
export function fixError(plan: TranslationPlan, key: string, translations: string[]): void {
  const u = findUnit(plan, key);
  if (translations.length !== u.segments.length) throw new Error("Số câu không khớp với đoạn gốc.");
  translations.forEach((t, i) => {
    if (!t.trim()) throw new Error(`Câu ${i + 1} đang trống.`);
    const r = restore(t, u.segments[i].tokens);
    if (!r.ok) throw new Error(`Câu ${u.segments.length > 1 ? i + 1 + " " : ""}chưa đúng: ${r.reason}`);
  });
  const reason = u.assemble(translations);
  if (reason) throw new Error(`Bản dịch chưa ghép được vào game: ${reason}`);
  plan.tm.transaction(() => u.segments.forEach((s, i) => plan.tm.set(s.text, translations[i], plan.from, plan.to, "manual")));
}

/** Giữ bản gốc cho các đoạn (ẩn khỏi danh sách lỗi; game hiện chữ gốc). */
export function keepOriginal(session: GameSession, plan: TranslationPlan, keys: string[]): void {
  const review = loadReview(session);
  for (const key of keys) review.kept[key] = findUnit(plan, key).entries.length;
  writeJson(reviewPath(session), review, true);
}

/** Bỏ đánh dấu "giữ bản gốc" (đoạn quay lại danh sách lỗi). */
export function unkeepAll(session: GameSession): void {
  writeJson(reviewPath(session), { kept: {} }, true);
}

export interface RetranslateResult {
  /** Số đoạn đã sửa được. */
  fixed: number;
  /** Số đoạn AI vẫn làm hỏng mã. */
  stillBroken: number;
  engine?: string;
  costUsd?: number;
  /** Người dùng không đồng ý dùng engine trả phí / không có key. */
  cancelled: boolean;
}

/**
 * Nhờ engine trả phí (AI) dịch lại các đoạn lỗi. HỎI trước khi dùng (ctx.prompt.confirmPaid).
 * Chỉ lưu bản dịch nào giữ đủ mã điều khiển; câu AI vẫn làm hỏng thì để nguyên.
 */
export async function retranslateErrors(
  ctx: AppContext, plan: TranslationPlan, keys: string[], maxCost?: number,
): Promise<RetranslateResult> {
  const units = keys.map(k => findUnit(plan, k));
  const texts = [...new Set(units.flatMap(u => u.segments.map(s => s.text)))];
  const paidName = setupEngines(ctx).paidName;
  if (!paidName) throw new Error("Chưa cấu hình engine trả phí (config.json → paidEngine).");
  const provider = await offerPaid(ctx, paidName, texts, maxCost, "retranslate");
  if (!provider) return { fixed: 0, stillBroken: units.length, cancelled: true };

  const before = provider.usage ? { ...provider.usage } : undefined;
  const result = new Map<string, string>();
  for (let i = 0; i < texts.length; i += 30) {
    const batch = texts.slice(i, i + 30);
    const out = await provider.translateBatch(batch, plan.from, plan.to);
    batch.forEach((t, k) => { if (out[k] != null) result.set(t, out[k]!); });
  }

  let fixed = 0;
  plan.tm.transaction(() => {
    for (const u of units) {
      const tr = u.segments.map(s => result.get(s.text));
      if (tr.some(t => t === undefined)) continue;
      if (u.assemble(tr as string[])) continue;                  // vẫn hỏng mã → không lưu
      u.segments.forEach((s, i) => plan.tm.set(s.text, tr[i]!, plan.from, plan.to, provider.name));
      fixed++;
    }
  });
  const usage = provider.usage;
  const costUsd = usage && provider.pricing && before
    ? ((usage.input - before.input) * provider.pricing.input + (usage.output - before.output) * provider.pricing.output) / 1e6
    : undefined;
  return { fixed, stillBroken: units.length - fixed, engine: provider.name, costUsd, cancelled: false };
}
