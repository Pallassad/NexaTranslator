import { join, relative } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { exportToGame, restoreGame, type FileGroup, type FileResult, type RestoreResult } from "../core/exporter";
import type { GameSession } from "./session";

export interface ExportOptions {
  /** Ghi đè cả file "xung đột" (bản hiện tại được backup trước). */
  force?: boolean;
  /** Chạy thử: chỉ báo sẽ làm gì, không ghi. */
  dryRun?: boolean;
}

/** Export/restore LUÔN gồm mọi định dạng của game + fonts/ → restore khôi phục được hết. */
function exportOptions(session: GameSession, opt: ExportOptions) {
  const { formats, rpgm, paths } = session;
  const groups: FileGroup[] = formats.flatMap(f => f.exportGroups(paths));
  if (rpgm) {
    // Thư mục fonts (khi dùng Font Doctor): font mới + gamefont.css (MV)
    groups.push({
      prefix: "fonts/", outDir: join(paths.outDir, "fonts"),
      gameDir: join(rpgm.base, "fonts"), sourceDir: join(paths.projDir, "source-fonts"),
    });
  }
  return {
    groups, projDir: paths.projDir, gameDataDir: rpgm?.dataDir ?? paths.root,
    force: opt.force === true, dryRun: opt.dryRun === true,
  };
}

export interface ExportResult {
  results: FileResult[];
  dryRun: boolean;
  /** Lời nhắc của các định dạng đã xuất (vd "trong game chọn ngôn ngữ English"). */
  notes: string[];
}

/** Chép bản dịch vào game (kiểm tra hash, không ghi đè file lạ trừ khi force). */
export function exportGame(session: GameSession, opt: ExportOptions = {}): ExportResult {
  const o = exportOptions(session, opt);
  const needSource = o.groups.filter(g => g.requireSource);
  if (!needSource.some(g => existsSync(g.sourceDir))) {
    throw new Error(`Chưa có bản chép gốc (${needSource.map(g => g.sourceDir).join(", ")}). Hãy chạy translate cho game này trước.`);
  }
  if (!needSource.some(g => existsSync(g.outDir))) {
    throw new Error(`Chưa có bản dịch trong ${needSource.map(g => g.outDir).join(", ")}. Hãy chạy translate trước.`);
  }
  const results = exportToGame(o);
  const notes = session.formats
    .filter(f => f.note && existsSync(join(session.paths.outDir, f.outSubdir)))
    .map(f => f.note!);
  return { results, dryRun: o.dryRun, notes };
}

export interface RestoreGameResult {
  results: RestoreResult[];
  dryRun: boolean;
}

/** Đưa game về bản gốc. */
export function restoreGameFiles(session: GameSession, opt: ExportOptions = {}): RestoreGameResult {
  const o = exportOptions(session, opt);
  return { results: restoreGame(o), dryRun: o.dryRun };
}


// ---------------------------------------------------------------------------
// Dịch thử: thêm "[VI] " vào đầu mọi dòng rồi chép vào game – xem Nexa có lấy đúng chỗ chữ không
// trước khi tốn tiền / thời gian dịch thật. Không đụng tới bản dịch thật trong output/.
// ---------------------------------------------------------------------------

export const TEST_MARK = "[VI] ";

/** Thư mục chứa bản thử (riêng, không lẫn với output/ của bản dịch thật). */
const testRoot = (session: GameSession) => join(session.paths.projDir, "test-vi");

/** Ghi bản thử của các file đã chọn (định dạng đang dùng). Trả số dòng đã đánh dấu. */
export function buildTestMark(session: GameSession, files?: string[]): { files: number; lines: number } {
  const root = testRoot(session);
  rmSync(root, { recursive: true, force: true });
  const only = files?.length ? new Set(files.map(f => f.toLowerCase())) : undefined;
  const loaded = session.loadEntries(session.fmt, session.sourceDir(), only);
  let lines = 0;
  for (const f of loaded) {
    // Tên người nói / tên nhân vật giữ nguyên (đổi tên có thể làm sai khung tên, tham chiếu)
    const marked = f.entries.map(e => (e.kind === "speaker" ? e : { ...e, target: TEST_MARK + e.source }));
    lines += marked.filter(e => e.target !== undefined && e.kind !== "speaker").length;
    f.write(join(root, session.fmt.outSubdir, f.name), marked);
  }
  return { files: loaded.length, lines };
}

/** Chép bản thử vào game (hoặc chạy thử nếu dryRun). Phải gọi buildTestMark trước. */
export function exportTestMark(session: GameSession, opt: ExportOptions = {}): ExportResult {
  const root = testRoot(session);
  if (!existsSync(root)) throw new Error("Chưa tạo bản dịch thử.");
  const o = exportOptions(session, opt);
  // Chỉ nhóm file của định dạng đang dùng, lấy file từ thư mục bản thử thay cho output/
  const own = new Set(session.fmt.exportGroups(session.paths).map(g => g.prefix + "|" + g.gameDir));
  o.groups = o.groups
    .filter(g => own.has(g.prefix + "|" + g.gameDir))
    .map(g => ({ ...g, outDir: join(root, relative(session.paths.outDir, g.outDir)) }));
  return { results: exportToGame(o), dryRun: o.dryRun, notes: session.fmt.note ? [session.fmt.note] : [] };
}
