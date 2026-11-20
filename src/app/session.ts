import { basename, join, resolve } from "node:path";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { readJson } from "../core/writer";
import type { Entry } from "../core/types";
import { detectFormats, pickFormat } from "../formats/registry";
import type { DetectedFormat, FormatAdapter, GamePaths, LoadedFile } from "../formats/types";
import type { RpgmGame } from "../formats/rpgm/game";
import type { AppContext } from "./context";

/** Ký tự chỉ có trong tiếng Việt – dùng để phát hiện data đã bị dịch đè. */
const VIET = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

/** Data trong game đã bị chép đè bản dịch / bản test → không được lấy làm bản gốc để dịch. */
export class SourceInvalidError extends Error {
  readonly code = "source-invalid";
  constructor(readonly problem: string) {
    super(`Data hiện tại của game KHÔNG phải bản gốc: ${problem}.\n` +
      `   Hãy khôi phục thư mục data gốc của game từ backup rồi chạy lại lệnh.`);
  }
}

export interface OpenOptions {
  /** Chọn định dạng (vd "rpgm-data"); không có → định dạng ưu tiên nhất. */
  format?: string;
  /** Chụp lại bản sao data gốc từ game. */
  refreshSource?: boolean;
  /** Chỉ dùng bộ đọc của 1 công cụ (Electron). Không có → mọi bộ đọc (CLI). */
  adapters?: FormatAdapter[];
}

/**
 * 1 game đang mở: định dạng nhận diện được, các thư mục làm việc, cache file đã đọc.
 * Electron giữ 1 GameSession cho mỗi game đang mở; mở lại game → tạo session mới (cache mới).
 */
export class GameSession {
  readonly formats: DetectedFormat[];
  readonly fmt: DetectedFormat;
  readonly paths: GamePaths;
  /** output/<game>/reports/<định dạng> – entries.json, errors.json, progress.json. */
  readonly reportDir: string;
  /** output/<game>/<thư mục con của định dạng> – file đã dịch. */
  readonly fmtOut: string;
  /** Phần RPG Maker data của game (cần cho Font Doctor, tên nhân vật...). */
  readonly rpgmData?: DetectedFormat;
  readonly rpgm?: RpgmGame;

  private cache = new Map<string, LoadedFile | null>();
  private checkedSource = new Set<string>();

  constructor(private ctx: AppContext, readonly root: string, private opt: OpenOptions = {}) {
    this.formats = detectFormats(root, opt.adapters);
    this.fmt = pickFormat(this.formats, opt.format);
    const name = basename(resolve(root));
    this.paths = {
      root,
      outDir: join(ctx.workDir, "output", name),
      projDir: join(ctx.workDir, "projects", name),
    };
    this.reportDir = join(this.paths.outDir, "reports", this.fmt.id);
    this.fmtOut = join(this.paths.outDir, this.fmt.outSubdir);
    this.rpgmData = this.formats.find(f => f.id === "rpgm-data");
    this.rpgm = this.rpgmData?.rpgm;
  }

  /** Các định dạng khác (ngoài định dạng đang dùng) mà game cũng có. */
  get otherFormats(): DetectedFormat[] {
    return this.formats.filter(f => f !== this.fmt);
  }

  /**
   * Đọc + trích chữ các file được chọn (qua bộ đọc của định dạng).
   * File không có chữ → không đọc. File lỗi → cảnh báo và bỏ qua, không dừng cả lệnh.
   * @param only tên file (chữ thường); file "tùy chọn" chỉ được đọc khi có trong only.
   */
  loadEntries(fmt: DetectedFormat, dir: string, only?: Set<string>): LoadedFile[] {
    const files: LoadedFile[] = [];
    for (const f of fmt.files) {
      if (!f.hasText) continue;
      const lower = f.name.toLowerCase();
      if (only && !only.has(lower)) continue;
      if (f.optional && !only?.has(lower)) continue;

      const key = `${fmt.id}|${join(dir, f.name)}`;
      if (!this.cache.has(key)) {
        try {
          this.cache.set(key, fmt.load(dir, f.name));
        } catch (e) {
          const msg = (e as Error).message.split("\n")[0].slice(0, 80);
          this.ctx.emit({ type: "log", level: "warn", message: `⚠ Bỏ qua ${f.name}: không đọc được (${msg})` });
          this.cache.set(key, null);
        }
      }
      const loaded = this.cache.get(key);
      if (loaded?.entries.length) files.push(loaded);
    }
    return files;
  }

  /**
   * Chụp (nếu chưa có) và trả về thư mục chứa bản GỐC để đọc chữ.
   * Ném lỗi nếu data game hiện tại đã bị chép đè bản dịch / bản test (không được lấy làm bản gốc).
   */
  sourceDirOf(f: DetectedFormat): string {
    const dir = f.sourceDir(this.paths);
    if (this.checkedSource.has(f.id)) return dir; // đã kiểm tra trong session này
    const { created } = f.snapshot(this.paths, this.opt.refreshSource === true);
    const all = this.loadEntries(f, dir).flatMap(x => x.entries);
    const marked = all.filter(e => e.source.startsWith("[VI]")).length;
    const viet = all.filter(e => VIET.test(e.source)).length;
    const problem = marked
      ? `có ${marked} dòng bắt đầu bằng "[VI]" (data đã bị chép đè bản test)`
      : viet > all.length * 0.05
        ? `có ${viet} dòng đã là tiếng Việt (data đã bị chép đè bản dịch)`
        : null;
    if (problem && created) {
      rmSync(dir, { recursive: true, force: true });
      this.dropCache(dir);
      throw new SourceInvalidError(problem);
    }
    if (problem) {
      this.ctx.emit({ type: "log", level: "warn",
        message: `⚠ Bản sao data gốc trong ${dir} ${problem}. Khôi phục data gốc của game rồi chạy lại kèm --refresh-source.` });
    }
    if (created) this.ctx.emit({ type: "snapshot", dir });
    this.checkedSource.add(f.id);
    return dir;
  }

  /** Thư mục bản gốc của định dạng đang dùng. */
  sourceDir(): string {
    return this.sourceDirOf(this.fmt);
  }

  /** Bản dịch đã lưu của mọi định dạng (output/<game>/reports/<định dạng>/entries.json). */
  translatedTexts(): string[] {
    const reports = join(this.paths.outDir, "reports");
    if (!existsSync(reports)) return [];
    return readdirSync(reports).flatMap(id => {
      const p = join(reports, id, "entries.json");
      return existsSync(p) ? (readJson(p) as Entry[]).map(e => e.target ?? "").filter(Boolean) : [];
    });
  }

  private dropCache(dir: string) {
    for (const k of this.cache.keys()) if (k.includes(dir)) this.cache.delete(k);
  }
}

/** Mở game (nhận diện định dạng). Không phải game hỗ trợ → ném lỗi dễ hiểu. */
export function openGame(ctx: AppContext, root: string, opt: OpenOptions = {}): GameSession {
  return new GameSession(ctx, root, opt);
}
