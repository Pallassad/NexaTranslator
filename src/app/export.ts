import { join } from "node:path";
import { existsSync } from "node:fs";
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
