import type { Unit } from "./units";
import type { TranslationProvider } from "./providers/types";
import { costOf } from "./providers/types";
import { EngineUnavailable } from "./providers/errors";
import type { TranslationMemory } from "./memory";

export interface Progress {
  done: number;
  total: number;
  engine: string;
  /** Chi phí (USD) engine đang chạy đã dùng. */
  costUsd: number;
  elapsedMs: number;
}

export interface TranslateOptions {
  from: string;
  to: string;
  /** Số câu mỗi lô; memory được ghi sau mỗi lô → dừng giữa chừng không mất phần đã dịch. */
  batchSize?: number;
  /** Dừng khi engine trả phí dùng quá số USD này (tính trong lần chạy hiện tại). */
  maxCost?: number;
  /** Engine dự phòng cho câu engine chính không dịch (AI từ chối) – thường là Google. */
  fallback?: TranslationProvider;
  onProgress?: (p: Progress) => void;
  /** Người dùng bấm "Dừng" → dừng trước lô kế tiếp (lô đang gửi vẫn được lưu). */
  signal?: AbortSignal;
}

/** Thống kê một lần chạy. */
export interface RunStats {
  /** Số câu dịch được theo tên engine. */
  byEngine: Map<string, number>;
  /** Số câu AI không dịch nhưng engine dự phòng đã dịch. */
  fallbackUsed: number;
  /** Số câu không engine nào dịch được. */
  failed: number;
}

/** Dừng có chủ đích (chạm --max-cost...). */
export class StopTranslation extends Error {}

/** Câu không có chữ cái nào ngoài placeholder {n}. */
export const isTrivial = (t: string) => !/\p{L}/u.test(t.replace(/\{\d+\}/g, ""));

export function newStats(): RunStats {
  return { byEngine: new Map(), fallbackUsed: 0, failed: 0 };
}

/** Các câu (đã bảo vệ placeholder) chưa có trong memory, không trùng lặp. */
export function pendingSegments(units: Unit[], tm: TranslationMemory, from: string, to: string): string[] {
  return [...new Set(units.flatMap(u => u.segments.map(s => s.text)))]
    .filter(t => tm.get(t, from, to) === undefined);
}

/**
 * Dịch các câu còn thiếu bằng 1 engine. Ghi memory sau mỗi lô.
 * Ném EngineUnavailable khi engine bị chặn / hết credit, StopTranslation khi chạm max-cost.
 */
export async function translatePending(
  pending: string[], provider: TranslationProvider, tm: TranslationMemory,
  opt: TranslateOptions, stats: RunStats,
): Promise<void> {
  const { from, to, batchSize = 50 } = opt;
  // Câu không còn chữ sau khi bỏ placeholder (vd cả câu là 1 thuật ngữ glossary, "...", "100")
  // → giữ nguyên, không cần gửi đi dịch.
  const trivial = pending.filter(isTrivial);
  if (trivial.length) {
    tm.transaction(() => trivial.forEach(t => tm.set(t, t, from, to, "glossary")));
    pending = pending.filter(t => !isTrivial(t));
  }
  const startCost = costOf(provider);
  const started = Date.now();

  for (let i = 0; i < pending.length; i += batchSize) {
    if (opt.signal?.aborted) throw new StopTranslation("Đã dừng theo yêu cầu");
    const batch = pending.slice(i, i + batchSize);
    const result = await provider.translateBatch(batch, from, to);
    if (result.length !== batch.length) throw new Error(`${provider.name} trả về sai số câu`);

    // Câu engine chính không dịch (AI từ chối) → thử engine dự phòng
    const missing = batch.filter((_, k) => result[k] == null);
    let fallbackResult: (string | null)[] = [];
    if (missing.length && opt.fallback) {
      try {
        fallbackResult = await opt.fallback.translateBatch(missing, from, to);
      } catch (e) {
        if (!(e instanceof EngineUnavailable)) throw e;
        fallbackResult = missing.map(() => null); // dự phòng cũng bị chặn → để nguyên bản gốc
      }
    }

    tm.transaction(() => {
      let m = 0;
      batch.forEach((t, k) => {
        if (result[k] != null) {
          tm.set(t, result[k]!, from, to, provider.name);
          stats.byEngine.set(provider.name, (stats.byEngine.get(provider.name) ?? 0) + 1);
        } else {
          const fb = fallbackResult[m++];
          if (fb != null && opt.fallback) {
            tm.set(t, fb, from, to, opt.fallback.name);
            stats.fallbackUsed++;
          } else {
            stats.failed++;
          }
        }
      });
    });

    const spent = costOf(provider) - startCost;
    opt.onProgress?.({
      done: Math.min(i + batchSize, pending.length), total: pending.length,
      engine: provider.name, costUsd: spent, elapsedMs: Date.now() - started,
    });
    if (provider.paid && opt.maxCost !== undefined && spent >= opt.maxCost) {
      throw new StopTranslation(`Đã chạm giới hạn chi phí $${opt.maxCost} (đã dùng ~$${spent.toFixed(3)})`);
    }
  }
}

export interface UnitError { file: string; path: (string | number)[]; source: string; reason: string; }

/**
 * Ghép bản dịch từ memory vào Entry. Unit chưa dịch đủ → giữ nguyên bản gốc.
 * Gọi được cả khi dịch dở dang (để xuất phần đã dịch).
 */
export function assembleUnits(units: Unit[], tm: TranslationMemory, from: string, to: string) {
  const errors: UnitError[] = [];
  let untranslated = 0;
  for (const u of units) {
    const translated = u.segments.map(s => tm.get(s.text, from, to));
    if (translated.some(t => t === undefined)) {
      for (const e of u.entries) delete e.target;
      untranslated++;
      continue;
    }
    const reason = u.assemble(translated as string[]);
    if (reason) {
      for (const e of u.entries) {
        delete e.target;
        errors.push({ file: e.file, path: e.path, source: e.source, reason });
      }
    }
  }
  return { errors, untranslated };
}
