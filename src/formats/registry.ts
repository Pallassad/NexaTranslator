import { rpgmData } from "./rpgm-data";
import { rpgmKnsCsv } from "./rpgm-kns-csv";
import { rpgmRemLoc } from "./rpgm-rem-loc";
import { rpgmLangTsv } from "./rpgm-lang-tsv";
import { rpgmNotFound } from "./rpgm/game";
import type { DetectedFormat, FormatAdapter } from "./types";

/**
 * Danh sách các bộ đọc định dạng. Thêm định dạng mới (vd rpgm-kns-csv, renpy) → thêm vào đây.
 */
export const ADAPTERS: FormatAdapter[] = [rpgmRemLoc, rpgmLangTsv, rpgmKnsCsv, rpgmData];

/** Mọi định dạng game này dùng, xếp theo priority (cao nhất trước). */
export function detectFormats(root: string, adapters: FormatAdapter[] = ADAPTERS): DetectedFormat[] {
  const found = adapters.map(a => a.detect(root)).filter((d): d is DetectedFormat => d !== null);
  if (found.length === 0) {
    // Hiện tại chỉ hỗ trợ game RPGM → dùng thông báo lỗi chi tiết của RPGM
    throw rpgmNotFound(root);
  }
  return found.sort((a, b) => b.priority - a.priority);
}

/** Chọn định dạng: theo --format nếu có, không thì lấy cái ưu tiên nhất. */
export function pickFormat(formats: DetectedFormat[], id?: string): DetectedFormat {
  if (!id) return formats[0];
  const f = formats.find(x => x.id === id);
  if (!f) {
    throw new Error(`Game này không dùng định dạng "${id}". Có: ${formats.map(x => x.id).join(", ")}`);
  }
  return f;
}
