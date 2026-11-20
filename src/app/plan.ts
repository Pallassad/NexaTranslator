import { join, dirname } from "node:path";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import type { Entry } from "../core/types";
import { buildUnits, measureMaxChars, type Unit } from "../core/units";
import { assembleUnits, pendingSegments } from "../core/translate";
import { TranslationMemory } from "../core/memory";
import {
  GlossaryMatcher, actorGlossary, dropCommonWords, loadGlossaryFile, mapNamesToSync, mergeGlossaries,
  type Glossary, type GlossaryFile,
} from "../core/glossary";
import { estimateCost, estimateMinutes, type Range } from "../core/estimate";
import type { LoadedFile } from "../formats/types";
import type { AppContext } from "./context";
import type { GameSession } from "./session";

export interface PlanOptions {
  /** Chỉ các file này (--files). Không có → tất cả file có chữ (trừ file tùy chọn). */
  files?: string[];
  from?: string;
  to?: string;
  /** Số ký tự tối đa mỗi dòng thoại; không có → tự đo từ game. */
  width?: number;
}

export interface PlanSummary {
  /** Số file / dòng chữ được chọn. */
  files: number;
  lines: number;
  /** Số câu sau khi gộp dòng. */
  segments: number;
  /** Số câu khác nhau và tổng ký tự của chúng. */
  unique: number;
  uniqueChars: number;
  /** Số câu khác nhau đã có trong memory. */
  cached: number;
  /** Số câu cần dịch và tổng ký tự. */
  pending: number;
  pendingChars: number;
}

export interface GlossaryInfo {
  /** projects/<game>/glossary.json – file người dùng sửa. */
  path: string;
  /** Tên tự động giữ nguyên (tên nhân vật). */
  autoKeep: string[];
  user: GlossaryFile;
  global: GlossaryFile;
  /** Tên khu vực cần đồng bộ vào thoại. */
  mapSync: Entry[];
  /** Bản dịch tên khu vực đã có trong memory. */
  mapTerms: Record<string, string>;
}

/**
 * Mọi thứ đã chuẩn bị cho 1 lần dịch / ước tính / xem glossary:
 * file đã đọc, câu đã gộp (units), memory, glossary.
 * NHỚ gọi close() khi xong (đóng file memory.db – Windows khóa file đang mở).
 */
export class TranslationPlan {
  units: Unit[];
  private mapUnitsCache?: Unit[];

  constructor(
    readonly from: string,
    readonly to: string,
    readonly maxChars: number,
    readonly files: LoadedFile[],
    readonly entries: Entry[],
    readonly tm: TranslationMemory,
    readonly glossary: GlossaryInfo,
  ) {
    this.units = this.buildMainUnits();
  }

  /** Glossary đầy đủ hiện tại (tên giữ nguyên + thuật ngữ + tên khu vực đã dịch). */
  currentGlossary(): Glossary {
    const g = this.glossary;
    return mergeGlossaries({ keep: g.autoKeep, terms: g.mapTerms }, actorGlossary(g.user.actors), g.global, g.user);
  }

  private buildMainUnits(): Unit[] {
    return buildUnits(this.entries, { maxChars: this.maxChars, glossary: new GlossaryMatcher(this.currentGlossary()) });
  }

  /** Câu chưa có trong memory. */
  pending(): string[] {
    return pendingSegments(this.units, this.tm, this.from, this.to);
  }

  /** Unit của các tên khu vực (dịch trước để dùng thống nhất trong thoại). */
  mapUnits(): Unit[] {
    const g = this.glossary;
    const base = mergeGlossaries({ keep: g.autoKeep, terms: {} }, actorGlossary(g.user.actors), g.global, g.user);
    this.mapUnitsCache = buildUnits(g.mapSync.map(e => ({ ...e, target: undefined })),
      { maxChars: this.maxChars, glossary: new GlossaryMatcher(base) });
    return this.mapUnitsCache;
  }

  /**
   * Đọc lại bản dịch tên khu vực từ memory; có thay đổi → dựng lại units với glossary mới.
   * Gọi sau khi dịch xong giai đoạn 1.
   */
  refreshMapTerms(): void {
    const terms = collectMapTerms(this.mapUnitsCache ?? this.mapUnits(), this.tm, this.from, this.to);
    if (Object.keys(terms).length !== Object.keys(this.glossary.mapTerms).length) {
      this.glossary.mapTerms = terms;
      this.units = this.buildMainUnits();
    }
  }

  summary(): PlanSummary {
    const segs = this.units.flatMap(u => u.segments.map(s => s.text));
    const uniq = new Set(segs);
    const pending = this.pending();
    return {
      files: this.files.length,
      lines: this.entries.length,
      segments: segs.length,
      unique: uniq.size,
      uniqueChars: [...uniq].reduce((n, s) => n + s.length, 0),
      cached: uniq.size - pending.length,
      pending: pending.length,
      pendingChars: pending.reduce((n, s) => n + s.length, 0),
    };
  }

  close(): void {
    this.tm.close();
  }
}

/** Bản dịch tên khu vực đang có trong memory. */
function collectMapTerms(units: Unit[], tm: TranslationMemory, from: string, to: string): Record<string, string> {
  assembleUnits(units, tm, from, to);
  const out: Record<string, string> = {};
  for (const u of units) for (const e of u.entries) {
    if (e.target && e.target !== e.source) out[e.source] = e.target;
  }
  return out;
}

/** Mở memory.db (chuyển memory.json kiểu cũ nếu có). */
function openMemory(session: GameSession): TranslationMemory {
  const { outDir, projDir } = session.paths;
  const oldMem = join(outDir, "memory.json");
  const jsonMem = join(projDir, "memory.json");
  if (existsSync(oldMem) && !existsSync(jsonMem) && !existsSync(join(projDir, "memory.db"))) {
    mkdirSync(dirname(jsonMem), { recursive: true });
    copyFileSync(oldMem, jsonMem);
  }
  return new TranslationMemory(join(projDir, "memory.db"));
}

/** Độ rộng dòng thoại tự đo từ toàn bộ game (dùng khi người dùng không tự đặt). */
export function autoWidth(session: GameSession): number {
  return measureMaxChars(session.loadEntries(session.fmt, session.sourceDir()).flatMap(f => f.entries));
}

/** Chuẩn bị dịch: đọc file, đo độ rộng dòng, mở memory, dựng glossary. */
export function prepareTranslation(ctx: AppContext, session: GameSession, opt: PlanOptions = {}): TranslationPlan {
  const { cfg } = ctx;
  const { fmt, rpgmData, paths } = session;
  const only = opt.files?.length ? new Set(opt.files.map(s => s.trim().toLowerCase())) : undefined;
  const from = opt.from || cfg.from;
  const to = opt.to || cfg.to;
  const src = session.sourceDir();

  // Đo độ rộng dòng thoại trên TOÀN BỘ game (kể cả file không chọn) để ngắt dòng đồng đều
  const allEntries = session.loadEntries(fmt, src).flatMap(f => f.entries);
  const maxChars = opt.width || measureMaxChars(allEntries);
  const files = session.loadEntries(fmt, src, only);
  if (only) {
    const names = new Set(fmt.files.map(f => f.name.toLowerCase()));
    const withText = new Set(files.map(f => f.name.toLowerCase()));
    for (const n of only) {
      if (!names.has(n)) {
        ctx.emit({ type: "log", level: "warn",
          message: `⚠ Không có file "${n}" trong game (gõ sai tên? ví dụ Map010.json chứ không phải Map0010.json)` });
      } else if (!withText.has(n)) {
        ctx.emit({ type: "log", level: "info", message: `ℹ "${n}" không có chữ nào cần dịch → bỏ qua` });
      }
    }
  }
  if (files.length === 0) throw new Error("Không có file nào để dịch.");
  const entries = files.flatMap(f => f.entries);

  // ---- Glossary: lấy từ TOÀN BỘ game để tên nhân vật / khu vực nhất quán ----
  const glossPath = join(paths.projDir, "glossary.json");
  const user = loadGlossaryFile(glossPath);
  const globalPath = join(ctx.workDir, "glossary.json");
  const global = existsSync(globalPath) ? loadGlossaryFile(globalPath, false) : { keep: [], terms: {}, translate: [], actors: {} };
  const optOut = new Set([...global.translate, ...user.translate]);
  const keepSrc = fmt.keepNames ? fmt : rpgmData;
  const autoKeep = dropCommonWords(
    keepSrc?.keepNames?.(keepSrc === fmt ? src : session.sourceDirOf(keepSrc)) ?? [],
    allEntries.map(e => e.source),
  ).filter(n => !optOut.has(n));
  const userTermKeys = new Set([
    ...Object.keys(global.terms), ...Object.keys(user.terms), ...Object.keys(user.actors),
    ...mergeGlossaries({ keep: autoKeep, terms: {} }, global, user).keep,
  ]);
  const mapSync = mapNamesToSync(allEntries, userTermKeys);

  // Mở memory SAU khi mọi bước có thể lỗi ở trên đã xong → lỗi thì không để file memory.db bị khóa
  const tm = openMemory(session);
  try {
    const glossary: GlossaryInfo = { path: glossPath, autoKeep, user, global, mapSync, mapTerms: {} };
    const plan = new TranslationPlan(from, to, maxChars, files, entries, tm, glossary);
    plan.refreshMapTerms();
    return plan;
  } catch (e) {
    tm.close();
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Ước tính + glossary (dữ liệu để hiển thị)
// ---------------------------------------------------------------------------

export interface EstimateRow {
  engine: string;
  /** undefined = miễn phí. */
  cost?: Range;
  minutes: Range;
  /** Có ghi chú (vd Google: chưa tính lúc bị chặn). */
  note?: string;
}

/** Ước tính chi phí / thời gian cho các câu còn phải dịch. */
export function estimateRows(ctx: AppContext, pending: string[]): EstimateRow[] {
  if (!pending.length) return [];
  const { cfg } = ctx;
  const chars = pending.reduce((n, s) => n + s.length, 0);
  const rows: EstimateRow[] = [{
    engine: "Google (Free)",
    minutes: estimateMinutes("google", chars, pending.length),
    note: "chưa tính lúc bị chặn",
  }];
  for (const [model, price] of Object.entries(cfg.pricing ?? {})) {
    rows.push({
      engine: model,
      cost: estimateCost(chars, pending.length, price, cfg.claude?.batchSize),
      minutes: estimateMinutes("ai", chars, pending.length, cfg.claude?.batchSize),
    });
  }
  return rows;
}

export interface GlossaryTermRow {
  source: string;
  target: string;
  origin: "user" | "global" | "map" | "actor";
}

export interface GlossaryView {
  path: string;
  keep: string[];
  autoKeepCount: number;
  /** Tên tự động giữ nguyên (tên nhân vật) – để phân biệt với tên người dùng tự thêm. */
  autoKeep: string[];
  terms: GlossaryTermRow[];
  /** Số thuật ngữ do người dùng tự thêm (glossary của game + glossary chung). */
  userTermCount: number;
  /** Tên khu vực sẽ đồng bộ khi dịch nhưng chưa dịch. */
  mapNotYet: string[];
  mapSyncCount: number;
  /** Phần người dùng tự sửa (glossary.json của game) – để sửa trong app. */
  user: { keep: string[]; terms: Record<string, string>; translate: string[] };
}

export function glossaryView(plan: TranslationPlan): GlossaryView {
  const g = plan.currentGlossary();
  const info = plan.glossary;
  return {
    path: info.path,
    keep: g.keep,
    autoKeepCount: info.autoKeep.length,
    autoKeep: info.autoKeep,
    terms: Object.entries(g.terms).map(([source, target]) => ({
      source, target,
      origin: source in info.user.terms ? "user" : source in info.global.terms ? "global"
        : source in info.user.actors ? "actor" : "map",
    })),
    userTermCount: Object.keys(info.user.terms).length + Object.keys(info.global.terms).length,
    mapNotYet: info.mapSync.filter(e => !(e.source in info.mapTerms)).map(e => e.source),
    mapSyncCount: info.mapSync.length,
    user: { keep: info.user.keep, terms: info.user.terms, translate: info.user.translate },
  };
}
