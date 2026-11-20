import { join } from "node:path";
import { existsSync } from "node:fs";
import { readJson, writeJson } from "../core/writer";
import { translatePending, assembleUnits, newStats, StopTranslation, type Progress } from "../core/translate";
import { EngineUnavailable } from "../core/providers/errors";
import { costOf, type TranslationProvider } from "../core/providers/types";
import { applyFontChoice, loadFontChoice } from "../formats/rpgm/fonts";
import type { AppContext } from "./context";
import type { GameSession } from "./session";
import type { TranslationPlan } from "./plan";
import { offerPaid, setupEngines } from "./engines";

export interface TranslateOptions {
  /** Engine chọn (--engine); không có → theo config.json. */
  engines?: string[];
  /** Dừng khi engine trả phí dùng quá số USD này. */
  maxCost?: number;
  /** Nút "Dừng" của giao diện. */
  signal?: AbortSignal;
}

export interface EngineUsage {
  engine: string;
  sentences: number;
  /** Chỉ engine trả phí có. */
  tokensIn?: number;
  tokensOut?: number;
  /** undefined = engine miễn phí hoặc chưa có giá trong config.json. */
  costUsd?: number;
  paid: boolean;
}

export interface FileProgress {
  file: string;
  lines: number;
  translated: number;
  /**
   * Số dòng GIỮ BẢN GỐC vì bản dịch máy làm hỏng mã điều khiển (\C[2], \N[1]...).
   * Đã xử lý xong (không còn gì để dịch) nhưng nên xem lại – xem src/app/review.ts.
   */
  kept: number;
}

/** File đã xử lý xong: mọi dòng đã dịch hoặc được giữ bản gốc vì lỗi mã. */
export const fileComplete = (p: { lines: number; translated: number; kept?: number }) =>
  p.translated + (p.kept ?? 0) >= p.lines;

export interface TranslateResult {
  /**
   * done = dịch hết; stopped = dừng giữa chừng (vẫn xuất phần đã dịch);
   * cancelled = người dùng không đồng ý dùng engine trả phí ngay từ đầu (không ghi gì).
   */
  status: "done" | "stopped" | "cancelled";
  stopReason?: string;
  elapsedMs: number;
  engines: EngineUsage[];
  /** Có engine trả phí có bảng giá → chi phí là ước tính. */
  pricedPaid: boolean;
  fallbackUsed: number;
  failed: number;
  untranslated: number;
  errorCount: number;
  errorsPath: string;
  files: FileProgress[];
  progressPath: string;
  /** Thư mục chứa file đã dịch. */
  outDir: string;
  /** Font Doctor đã áp font nào vào bản xuất. */
  fontApplied?: string;
}

/**
 * Dịch + xuất kết quả (kể cả khi dừng giữa chừng).
 * Khi engine miễn phí bị chặn → HỎI (ctx.prompt) trước khi dùng engine trả phí.
 */
export async function runTranslate(
  ctx: AppContext, session: GameSession, plan: TranslationPlan, opt: TranslateOptions = {},
): Promise<TranslateResult> {
  const { from, to, tm } = plan;
  const { maxCost, signal } = opt;
  const engines = setupEngines(ctx, opt.engines);
  let current: TranslationProvider | null = engines.free;
  let paidProvider: TranslationProvider | null = null;
  const t0 = Date.now();

  if (!current) {
    current = engines.paidName ? await offerPaid(ctx, engines.paidName, plan.pending(), maxCost, "chosen") : null;
    if (!current) return emptyResult(session, t0);
    paidProvider = current;
  }

  const stats = newStats();
  let stopReason: string | null = null;
  // Tiến độ tổng: runBase = số câu đã xong trước lượt translatePending hiện tại
  let overallTotal = 0, overallDone = 0, runBase = 0;
  let phase: "map-names" | "main" = "main";
  const onProgress = (p: Progress) => {
    overallDone = runBase + p.done;
    // Số câu lõi THỰC SỰ dịch ở lượt này (có thể ít hơn ước tính: bỏ câu trùng / câu chỉ có mã)
    overallTotal = runBase + p.total;
    const elapsed = Date.now() - t0;
    const etaMs = overallDone ? (elapsed / overallDone) * Math.max(0, overallTotal - overallDone) : 0;
    ctx.emit({ type: "progress", ...p, etaMs, overallDone, overallTotal, phase, paid: current?.paid === true });
  };

  /** Dịch danh sách câu; engine miễn phí bị chặn → hỏi chuyển sang trả phí. false = phải dừng. */
  const run = async (list: string[]): Promise<boolean> => {
    let todo = list;
    while (todo.length) {
      runBase = overallDone;
      try {
        await translatePending(todo, current!, tm, {
          from, to, maxCost, onProgress, signal,
          batchSize: current!.paid ? 30 : 50,
          fallback: current!.paid ? engines.fallback : undefined,
        }, stats);
        ctx.emit({ type: "progress-end" });
        return true;
      } catch (e) {
        ctx.emit({ type: "progress-end" });
        if (e instanceof StopTranslation) { stopReason = e.message; return false; }
        if (!(e instanceof EngineUnavailable)) throw e;
        ctx.emit({ type: "engine-unavailable", message: e.message });
        todo = todo.filter(t => tm.get(t, from, to) === undefined);
        if (!current!.paid && engines.paidName) {
          const p = await offerPaid(ctx, engines.paidName, plan.pending(), maxCost);
          if (p) {
            current = paidProvider = p;
            ctx.emit({ type: "engine-switch", engine: p.name });
            continue;
          }
          stopReason = "Không dùng engine trả phí";
        } else {
          stopReason = e.kind === "credit"
            ? "Tài khoản AI hết credit – nạp thêm rồi chạy lại cùng lệnh để dịch tiếp"
            : e.reason;
        }
        return false;
      }
    }
    return true;
  };

  // Giai đoạn 1: tên khu vực cần đồng bộ vào thoại
  const mapPending = pendingOf(plan);
  overallTotal = new Set([...mapPending, ...plan.pending()]).size;
  ctx.emit({ type: "translate-start", engine: current.name, from, to, maxChars: plan.maxChars, overallTotal, mapNames: mapPending.length });
  let ok = true;

  if (mapPending.length) {
    phase = "map-names";
    ctx.emit({ type: "phase", phase: "map-names", count: mapPending.length });
    ok = await run(mapPending);
    plan.refreshMapTerms();
  }

  // Giai đoạn 2: toàn bộ
  if (ok) {
    const rest = plan.pending();
    phase = "main";
    // Glossary tên khu vực đổi → câu được chia lại → tổng có thể khác chút: đặt lại cho khớp
    overallTotal = overallDone + rest.length;
    if (mapPending.length) ctx.emit({ type: "phase", phase: "main", count: rest.length });
    await run(rest);
  }

  // ---- Ghép bản dịch + xuất (kể cả khi dừng giữa chừng) ----
  const { errorCount, untranslated, files, errorsPath, progressPath, fontApplied } = writeOutput(ctx, session, plan);

  const usage: EngineUsage[] = [...stats.byEngine].map(([engine, n]) => {
    const paid = paidProvider && paidProvider.name === engine ? paidProvider : null;
    return {
      engine, sentences: n, paid: Boolean(paid),
      tokensIn: paid?.usage?.input, tokensOut: paid?.usage?.output,
      costUsd: paid?.usage && paid.pricing ? costOf(paid) : undefined,
    };
  });

  return {
    status: stopReason ? "stopped" : "done",
    stopReason: stopReason ?? undefined,
    elapsedMs: Date.now() - t0,
    engines: usage,
    pricedPaid: Boolean(paidProvider?.pricing),
    fallbackUsed: stats.fallbackUsed,
    failed: stats.failed,
    untranslated,
    errorCount,
    errorsPath,
    files,
    progressPath,
    outDir: session.fmtOut,
    fontApplied,
  };
}

/**
 * Ghép bản dịch từ memory vào các file của plan rồi ghi ra output/ (+ entries.json, errors.json, progress.json).
 * Dùng sau khi dịch, và sau khi người dùng sửa / giữ gốc dòng lỗi (không cần dịch lại).
 */
export function writeOutput(ctx: AppContext, session: GameSession, plan: TranslationPlan) {
  const { errors, untranslated } = assembleUnits(plan.units, plan.tm, plan.from, plan.to);
  for (const f of plan.files) f.write(join(session.fmtOut, f.name), f.entries);
  writeJson(join(session.reportDir, "entries.json"), plan.entries);
  const errorsPath = join(session.reportDir, "errors.json");
  writeJson(errorsPath, errors);
  const fontApplied = applyFont(ctx, session);

  const keptBy = new Map<string, number>();
  for (const e of errors) keptBy.set(e.file, (keptBy.get(e.file) ?? 0) + 1);
  const files: FileProgress[] = plan.files.map(f => ({
    file: f.name,
    lines: f.entries.length,
    translated: f.entries.filter(e => e.target !== undefined).length,
    kept: keptBy.get(f.name) ?? 0,
  }));
  const progressPath = join(session.reportDir, "progress.json");
  writeJson(progressPath, mergeProgress(session, progressPath, files).map(progressRow));
  return { errorCount: errors.length, untranslated, files, errorsPath, progressPath, fontApplied };
}

/** Đọc progress.json (mọi file). */
export function readProgress(path: string): Map<string, FileProgress> {
  const out = new Map<string, FileProgress>();
  if (!existsSync(path)) return out;
  try {
    for (const r of readJson(path) as Record<string, any>[]) {
      out.set(r.file, { file: r.file, lines: r["dòng"] ?? 0, translated: r["đã dịch"] ?? 0, kept: r["giữ gốc"] ?? 0 });
    }
  } catch { /* file hỏng → coi như chưa có */ }
  return out;
}

/**
 * progress.json luôn có MỌI file có chữ của game (không chỉ file của lần dịch này):
 * file vừa dịch → số mới; file khác → giữ số cũ; file chưa dịch bao giờ → 0.
 * Nhờ vậy thư viện tính đúng % của cả game.
 */
function mergeProgress(session: GameSession, path: string, current: FileProgress[]): FileProgress[] {
  const prev = readProgress(path);
  const now = new Map(current.map(f => [f.file, f]));
  // File thường (không tùy chọn) – đã đọc khi chuẩn bị dịch nên lấy từ cache, không đọc lại
  const all = session.loadEntries(session.fmt, session.sourceDir());
  const rows: FileProgress[] = all.map(f =>
    now.get(f.name) ?? prev.get(f.name) ?? { file: f.name, lines: f.entries.length, translated: 0, kept: 0 });
  // File tùy chọn đã từng dịch
  for (const f of [...current, ...prev.values()]) if (!rows.some(r => r.file === f.file)) rows.push(f);
  return rows;
}

/** Câu tên khu vực còn chưa dịch. */
function pendingOf(plan: TranslationPlan): string[] {
  const units = plan.mapUnits();
  return [...new Set(units.flatMap(u => u.segments.map(s => s.text)))]
    .filter(t => plan.tm.get(t, plan.from, plan.to) === undefined);
}

/** Áp font Font Doctor đã chọn (nếu có) vào bản xuất. */
function applyFont(ctx: AppContext, session: GameSession): string | undefined {
  const { rpgmData, rpgm, paths } = session;
  const choice = loadFontChoice(paths.projDir);
  if (!choice || !rpgmData || !rpgm) return undefined;
  applyFontChoice({
    choice, engine: rpgm.engine, outDir: paths.outDir, projDir: paths.projDir,
    sourceDir: session.sourceDirOf(rpgmData), gameDataDir: rpgm.dataDir,
  });
  ctx.emit({ type: "font-applied", file: choice.file });
  return choice.file;
}

/** Dòng trong progress.json (giữ định dạng cũ để người dùng đọc file quen thuộc). */
export function fileStatus(p: FileProgress): string {
  if (p.translated >= p.lines) return "✅ Xong";
  if (fileComplete(p)) return `✅ Xong (${p.kept} dòng giữ gốc)`;
  if (p.translated === 0) return "⬜ Chưa dịch";
  return `🟡 ${Math.min(99, Math.max(1, Math.floor((p.translated / p.lines) * 100)))}%`;
}

const progressRow = (p: FileProgress) => ({
  file: p.file, "dòng": p.lines, "đã dịch": p.translated, "giữ gốc": p.kept, "trạng thái": fileStatus(p),
});

function emptyResult(session: GameSession, t0: number): TranslateResult {
  return {
    status: "cancelled", elapsedMs: Date.now() - t0, engines: [], pricedPaid: false,
    fallbackUsed: 0, failed: 0, untranslated: 0, errorCount: 0,
    errorsPath: join(session.reportDir, "errors.json"), files: [],
    progressPath: join(session.reportDir, "progress.json"), outDir: session.fmtOut,
  };
}
