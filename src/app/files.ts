import { join } from "node:path";
import type { GameSession } from "./session";
import { readProgress } from "./translate";

/** 1 dòng trong danh sách chọn file (tab Dịch). */
export interface FileItem {
  name: string;
  /** Nhóm do bộ đọc trả về (story, items, skills, system, quest, npc...). */
  group: string;
  /** File tùy chọn: mặc định không chọn. */
  optional: boolean;
  /** Số dòng chữ (0 = đọc lỗi). */
  lines: number;
  /** Số dòng đã dịch theo progress.json lần trước; undefined = chưa dịch lần nào. */
  translated?: number;
  /** Số dòng giữ bản gốc vì bản dịch máy làm hỏng mã điều khiển. */
  kept?: number;
}

/**
 * Danh sách file có chữ của định dạng đang dùng, kèm số dòng và tiến độ lần dịch trước.
 * Đọc cả file tùy chọn (để biết số dòng) – tốn vài giây với game rất lớn, nên giao diện cần hiện "Đang đọc dữ liệu game...".
 */
export function listFiles(session: GameSession): FileItem[] {
  const { fmt } = session;
  const withText = fmt.files.filter(f => f.hasText);
  const all = new Set(withText.map(f => f.name.toLowerCase()));
  const loaded = new Map(session.loadEntries(fmt, session.sourceDir(), all).map(f => [f.name, f.entries.length]));

  const done = readProgress(join(session.reportDir, "progress.json"));

  return withText
    .filter(f => loaded.has(f.name))   // file không có dòng nào (sau khi đọc) → ẩn
    .map(f => ({
      name: f.name, group: f.group, optional: f.optional === true,
      lines: loaded.get(f.name) ?? 0,
      translated: done.get(f.name)?.translated,
      kept: done.get(f.name)?.kept,
    }));
}
