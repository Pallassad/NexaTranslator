import { join } from "node:path";
import {
  addGame, AddGameError, autoWidth, checkEngines, describeGame, estimateRows, exportGame, fontCheck, fontFix,
  fontReset, getGame, getTool, glossaryView, listFiles, listGames, openGame, prepareTranslation, removeGame,
  restoreGameFiles, runTranslate, setKey, SourceInvalidError, TOOLS, updateGame,
  listErrors, fixError, keepOriginal, retranslateErrors, reviewedLines, unkeepAll, writeOutput,
  actorNamesView, suggestActorNames, saveActorNames, saveUserGlossary, type UserGlossaryInput,
  type AppContext, type GameSession, type TranslationPlan,
} from "../src/app";
import { KEY_ENV, saveConfig } from "../src/core/config";
import { loadGlossaryFile } from "../src/core/glossary";
import type {
  ApiError, EstimateDTO, ExportPreview, GameView, GlossarySaveResult, NameLang, SettingsPatch, KeyStatus, SettingsDTO, ToolDTO, TranslateOptionsDTO,
} from "../shared/api";
import { PAID_ENGINES, SOURCE_LANGS, TRANSLATE_ENGINES } from "../shared/api";
import type { EncryptedKeyStore } from "./keystore";

/** Lỗi có mã → giao diện biết hiện hộp thoại nào. */
export class ApiFailure extends Error {
  constructor(readonly info: ApiError) { super(info.message); }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiFailure) return e.info;
  if (e instanceof SourceInvalidError) return { code: "source-invalid", message: e.problem };
  if (e instanceof AddGameError) return { code: "not-game", message: e.message, guess: e.guess };
  return { code: "error", message: e instanceof Error ? e.message : String(e) };
}

/**
 * Toàn bộ "việc" của app, chạy trong tiến trình chính.
 * - Giữ 1 GameSession cho mỗi game đang mở (cache file đã đọc).
 * - Chỉ cho 1 việc ghi dữ liệu chạy tại 1 thời điểm (dịch / chép vào game / khôi phục / sửa font).
 */
export class Backend {
  private sessions = new Map<string, GameSession>();
  private job: { kind: string; abort?: AbortController; done: Promise<unknown> } | null = null;

  constructor(readonly ctx: AppContext, readonly keys: EncryptedKeyStore, readonly dataDir: string) {}

  get busy(): boolean {
    return this.job !== null;
  }

  /** Chạy 1 việc độc quyền; đang có việc khác → báo lỗi "busy". */
  private async exclusive<T>(kind: string, fn: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
    if (this.job) throw new ApiFailure({ code: "busy", message: `Đang ${this.job.kind} – chờ xong hoặc bấm Dừng trước.` });
    const abort = new AbortController();
    const done = (async () => fn(abort.signal))();
    this.job = { kind, abort, done };
    try {
      return await done;
    } finally {
      this.job = null;
    }
  }

  /** Dừng việc đang chạy (dịch dừng sau lô hiện tại) và chờ nó kết thúc hẳn. */
  async stopAndWait(): Promise<void> {
    const j = this.job;
    if (!j) return;
    j.abort?.abort();
    await j.done.catch(() => {});
  }

  // ---------------------------------------------------------------- công cụ, thư viện
  tools(): ToolDTO[] {
    return TOOLS.map(t => ({
      id: t.id, name: t.name, description: t.description, status: t.status,
      adapters: t.adapters.map(a => ({ id: a.id, label: a.label })),
    }));
  }

  listGames(tool: string) {
    return listGames(this.ctx, tool).sort((a, b) => b.openedAt - a.openedAt);
  }

  addGame(tool: string, root: string) {
    return addGame(this.ctx, tool, root);
  }

  removeGame(id: string) {
    if (this.job) throw new ApiFailure({ code: "busy", message: "Đang có việc chạy – chờ xong rồi xóa." });
    removeGame(this.ctx, id);
    this.sessions.delete(id);
  }

  // ---------------------------------------------------------------- game
  private session(id: string, fresh = false): GameSession {
    let s = this.sessions.get(id);
    if (!s || fresh) {
      const g = getGame(this.ctx, id);
      s = openGame(this.ctx, g.root, { format: g.format, adapters: getTool(g.tool).adapters });
      this.sessions.set(id, s);
    }
    return s;
  }

  private view(id: string): GameView {
    const s = this.session(id);
    const files = listFiles(s);            // đọc + kiểm tra bản gốc (có thể ném SourceInvalidError)
    return {
      card: describeGame(this.ctx, getGame(this.ctx, id)),
      format: { id: s.fmt.id, label: s.fmt.label, note: s.fmt.note },
      autoWidth: autoWidth(s),
      files,
      hasFont: Boolean(s.rpgmData),
      errorLines: Math.max(0, files.reduce((n, f) => n + (f.kept ?? 0), 0) - reviewedLines(s)),
      reviewedLines: reviewedLines(s),
    };
  }

  /**
   * Plan để xem/sửa dòng lỗi: mọi file đã dịch (kể cả file tùy chọn từng dịch), cùng độ rộng dòng
   * lúc dịch → câu được chia y hệt, tìm đúng bản dịch trong memory.
   */
  private reviewPlan(id: string, width?: number): TranslationPlan {
    const s = this.session(id);
    const files = listFiles(s).filter(f => !f.optional || (f.translated ?? 0) > 0).map(f => f.name);
    return prepareTranslation(this.ctx, s, { files, width });
  }

  errors(id: string, width?: number) {
    const plan = this.reviewPlan(id, width);
    try { return listErrors(this.session(id), plan); } finally { plan.close(); }
  }

  /** Sửa xong → ghi lại bản dịch (output/) để "Chép vào game" lấy bản mới. */
  private rewrite(id: string, plan: TranslationPlan): GameView {
    writeOutput(this.ctx, this.session(id), plan);
    return this.view(id);
  }

  fixError(id: string, width: number | undefined, key: string, translations: string[]) {
    return this.exclusive("lưu bản dịch", () => {
      const plan = this.reviewPlan(id, width);
      try { fixError(plan, key, translations); return this.rewrite(id, plan); } finally { plan.close(); }
    });
  }

  keepErrors(id: string, width: number | undefined, keys: string[]) {
    return this.exclusive("lưu lựa chọn", () => {
      const plan = this.reviewPlan(id, width);
      try { keepOriginal(this.session(id), plan, keys); return this.rewrite(id, plan); } finally { plan.close(); }
    });
  }

  unkeepErrors(id: string, width: number | undefined) {
    return this.exclusive("lưu lựa chọn", () => { unkeepAll(this.session(id)); return this.view(id); });
  }

  retranslateErrors(id: string, width: number | undefined, keys: string[], maxCost?: number) {
    return this.exclusive("dịch lại dòng lỗi", async () => {
      const plan = this.reviewPlan(id, width);
      try {
        const result = await retranslateErrors(this.ctx, plan, keys, maxCost);
        return { result, view: this.rewrite(id, plan) };
      } finally { plan.close(); }
    });
  }

  openGame(id: string): GameView {
    updateGame(this.ctx, id, { openedAt: Date.now() });
    // Mở lại → đọc lại từ đầu (người dùng có thể đã sửa game / khôi phục data gốc)
    if (!this.job) this.sessions.delete(id);
    return this.view(id);
  }

  setFormat(id: string, format: string): GameView {
    if (this.job) throw new ApiFailure({ code: "busy", message: "Đang dịch – không đổi định dạng được." });
    updateGame(this.ctx, id, { format });
    this.sessions.delete(id);
    return this.view(id);
  }

  estimate(id: string, opt: TranslateOptionsDTO): EstimateDTO {
    const s = this.session(id);
    const plan = prepareTranslation(this.ctx, s, { files: opt.files, width: opt.width });
    try {
      return { summary: plan.summary(), rows: estimateRows(this.ctx, plan.pending()) };
    } finally {
      plan.close();
    }
  }

  translate(id: string, opt: TranslateOptionsDTO) {
    return this.exclusive("dịch", async signal => {
      const s = this.session(id);
      const plan = prepareTranslation(this.ctx, s, { files: opt.files, width: opt.width });
      try {
        // Chọn AI từ đầu → chỉ dùng engine đó (vẫn hỏi xác nhận chi phí trước). Google → theo config.json.
        const ai = opt.engine && opt.engine !== "google" && (TRANSLATE_ENGINES as readonly string[]).includes(opt.engine);
        const result = await runTranslate(this.ctx, s, plan, {
          maxCost: opt.maxCost, signal, engines: ai ? [opt.engine!] : undefined,
        });
        return { result, view: this.view(id) };
      } finally {
        plan.close();
      }
    });
  }

  exportPreview(id: string): ExportPreview {
    const r = exportGame(this.session(id), { dryRun: true }).results;
    return {
      write: r.filter(x => x.status === "new" || x.status === "update").map(x => x.name),
      same: r.filter(x => x.status === "same").length,
      conflicts: r.filter(x => x.status === "conflict").map(x => x.name),
      missingSource: r.filter(x => x.status === "missing-source").map(x => x.name),
    };
  }

  exportRun(id: string, force: boolean) {
    return this.exclusive("chép vào game", () => {
      const r = exportGame(this.session(id), { force });
      return { results: r.results, notes: r.notes, card: describeGame(this.ctx, getGame(this.ctx, id)) };
    });
  }

  restorePreview(id: string) {
    const r = restoreGameFiles(this.session(id), { dryRun: true }).results;
    return { count: r.filter(x => x.status === "restored").length, conflicts: r.filter(x => x.status === "conflict").map(x => x.name) };
  }

  restoreRun(id: string, force: boolean) {
    return this.exclusive("khôi phục bản gốc", () => {
      const r = restoreGameFiles(this.session(id), { force });
      return { results: r.results, card: describeGame(this.ctx, getGame(this.ctx, id)) };
    });
  }

  glossary(id: string) {
    const plan = prepareTranslation(this.ctx, this.session(id));
    try { return glossaryView(plan); } finally { plan.close(); }
  }

  /**
   * Sau khi glossary đổi: nếu không có câu nào phải dịch lại → ghi lại bản dịch ngay (tên mới vào Actors.json,
   * thoại...) để chỉ cần "Chép vào game". Còn câu phải dịch → KHÔNG ghi (tránh mất bản dịch các câu đó
   * trong output/) – người dùng bấm Dịch tiếp.
   * Chỉ ghi lại khi game đã từng dịch (có output).
   */
  private afterGlossaryChange(id: string, width?: number): GlossarySaveResult {
    const s = this.session(id);
    const translatedBefore = listFiles(s).some(f => (f.translated ?? 0) > 0);
    const plan = this.reviewPlan(id, width);
    try {
      const pending = plan.pending().length;
      const rewritten = pending === 0 && translatedBefore;
      if (rewritten) writeOutput(this.ctx, s, plan);
      return { pending, rewritten, view: this.view(id) };
    } finally { plan.close(); }
  }

  saveGlossary(id: string, width: number | undefined, g: UserGlossaryInput) {
    return this.exclusive("lưu glossary", () => {
      saveUserGlossary(this.session(id), g);
      return this.afterGlossaryChange(id, width);
    });
  }

  actorNames(id: string) {
    return actorNamesView(this.session(id));
  }

  suggestNames(names: string[], lang: NameLang) {
    return suggestActorNames(names, lang);
  }

  saveActorNames(id: string, width: number | undefined, names: Record<string, string>) {
    return this.exclusive("lưu tên nhân vật", () => {
      saveActorNames(this.session(id), names);
      return this.afterGlossaryChange(id, width);
    });
  }

  /** Đường dẫn glossary.json của game (tạo file mẫu nếu chưa có). */
  glossaryFile(id: string): string {
    const p = join(this.session(id).paths.projDir, "glossary.json");
    loadGlossaryFile(p);
    return p;
  }

  fontCheck(id: string) {
    return fontCheck(this.session(id));
  }

  fontFix(id: string, fontPath?: string) {
    return this.exclusive("sửa font", () => fontFix(this.session(id), fontPath));
  }

  fontReset(id: string) {
    return this.exclusive("khôi phục font", () => fontReset(this.session(id)));
  }

  /** Ảnh icon của game trong thư viện (undefined nếu không có). */
  iconOf(id: string): string | undefined {
    try { return describeGame(this.ctx, getGame(this.ctx, id)).iconPath; } catch { return undefined; }
  }

  gameRoot(id: string): string {
    return getGame(this.ctx, id).root;
  }

  // ---------------------------------------------------------------- engine, key, cài đặt
  checkEngines() {
    return checkEngines(this.ctx);
  }

  keyStatus(): KeyStatus[] {
    return Object.entries(KEY_ENV)
      .filter(([engine]) => engine !== "azure")       // Azure đã bỏ khỏi phạm vi
      .map(([engine, keyEnv]) => ({
        engine, keyEnv, has: Boolean(process.env[keyEnv]),
        source: process.env[keyEnv] ? (this.keys.loaded.has(keyEnv) ? "encrypted" : "env") : undefined,
      }));
  }

  setKey(engine: string) {
    return setKey(this.ctx, engine);
  }

  settings(): SettingsDTO {
    const c = this.ctx.cfg;
    // "claude" (kiểu cũ) = Claude theo claude.model → hiện thành Haiku / Sonnet cho dễ chọn
    const paid = c.paidEngine === "claude"
      ? (c.claude?.model?.includes("sonnet") ? "claude-sonnet" : "claude-haiku")
      : c.paidEngine ?? "";
    return {
      engines: c.engines, paidEngine: paid, from: c.from, to: c.to,
      maxCost: c.maxCost && c.maxCost > 0 ? c.maxCost : null,
      dataDir: this.dataDir, encryptionAvailable: this.keys.available,
    };
  }

  /** Ghi cài đặt vào config.json rồi dùng ngay (không cần mở lại app). */
  saveSettings(patch: SettingsPatch): SettingsDTO {
    if (this.job) throw new ApiFailure({ code: "busy", message: `Đang ${this.job.kind} – chờ xong rồi đổi cài đặt.` });
    const bad = (m: string) => new ApiFailure({ code: "error", message: m });
    if (patch.from !== undefined && !(SOURCE_LANGS as readonly string[]).includes(patch.from)) throw bad(`Ngôn ngữ gốc không hợp lệ: ${patch.from}`);
    if (patch.paidEngine !== undefined && !(PAID_ENGINES as readonly string[]).includes(patch.paidEngine)) {
      throw bad(`Engine trả phí không hợp lệ: ${patch.paidEngine}`);
    }
    if (patch.maxCost != null && !(Number.isFinite(patch.maxCost) && patch.maxCost > 0 && patch.maxCost <= 1000)) {
      throw bad("Giới hạn chi phí phải lớn hơn $0 và không quá $1.000");
    }
    const next = saveConfig(join(this.ctx.workDir, "config.json"), patch);
    Object.assign(this.ctx.cfg, next);
    return this.settings();
  }
}
