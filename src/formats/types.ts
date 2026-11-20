import type { Entry } from "../core/types";
import type { FileGroup } from "../core/exporter";
import type { RpgmGame } from "./rpgm/game";

/**
 * "Bộ đọc định dạng" (format adapter).
 *
 * Mỗi loại game lưu chữ theo cách khác nhau (RPGM data/*.json, CSV của plugin KNS, Ren'Py .rpy...).
 * Bộ đọc chỉ lo 3 việc: NHẬN DIỆN game, LẤY CHỮ RA (Entry[]) và GHI BẢN DỊCH VÀO.
 * Mọi thứ còn lại (engine dịch, memory, glossary, chia dòng, ước tính, export/restore) là phần lõi dùng chung.
 *
 * Thêm định dạng mới = viết 1 thư mục trong src/formats/ + đăng ký trong registry.ts.
 */

/** Thư mục làm việc của 1 game. */
/** 1 nhân vật trong Actors.json / DB_Actor.csv. */
export interface ActorRef { id: number; name: string }

export interface GamePaths {
  /** Thư mục game người dùng chọn. */
  root: string;
  /** output/<game> – bản dịch, bố cục giống thư mục game (data/, csv/, fonts/...). */
  outDir: string;
  /** projects/<game> – memory, glossary, bản chép gốc, backup (dùng chung mọi định dạng). */
  projDir: string;
}

export interface FormatFile {
  name: string;
  /** Nhóm để hiển thị / lọc (vd story, items, system...). */
  group: string;
  /** false = không có chữ cần dịch → không đọc, không hiện trong danh sách chọn. */
  hasText: boolean;
  /** true = mặc định KHÔNG dịch, chỉ dịch khi chọn rõ bằng --files (vd tên biến chỉ hiện ở màn hình debug). */
  optional?: boolean;
}

/** 1 file đã đọc + trích chữ. */
export interface LoadedFile {
  name: string;
  entries: Entry[];
  /** Ghi file kèm bản dịch (dòng chưa dịch giữ bản gốc). */
  write(outPath: string, entries: Entry[]): void;
  /** Ghi lại mà không đổi chữ nào → dữ liệu phải giống hệt bản gốc (kiểm tra an toàn). */
  roundtripOk(): boolean;
}

/** Kết quả nhận diện: game này dùng định dạng X. */
export interface DetectedFormat {
  id: string;
  label: string;
  /** Game khớp nhiều định dạng → mặc định chọn cái có priority cao nhất. */
  priority: number;
  /** Thông tin hiện ở lệnh scan. */
  info: string[];
  files: FormatFile[];
  /** Thư mục con trong output/<game> chứa file đã dịch (vd "data"). */
  outSubdir: string;
  /** Thư mục chứa bản chép GỐC (tool luôn đọc chữ từ đây). */
  sourceDir(paths: GamePaths): string;
  /** Chụp bản chép gốc nếu chưa có (refresh = chụp lại). */
  snapshot(paths: GamePaths, refresh: boolean): { created: boolean };
  /** Đọc + trích chữ 1 file trong thư mục dir. */
  load(dir: string, name: string): LoadedFile;
  /** Nhóm file để export/restore vào game. */
  exportGroups(paths: GamePaths): FileGroup[];
  /** Tên tự động giữ nguyên trong glossary (vd tên trong Actors.json). */
  keepNames?(sourceDir: string): string[];
  /** Danh sách nhân vật (id + tên gốc) – để đổi tên sang Romaji / Hán Việt. */
  actorNames?(sourceDir: string): ActorRef[];
  /** Lời nhắc in ra sau khi dịch / export (vd "trong game chọn ngôn ngữ English"). */
  note?: string;
  /** Có khi là game RPG Maker (dùng cho Font Doctor). */
  rpgm?: RpgmGame;
}

export interface FormatAdapter {
  id: string;
  label: string;
  /** Không khớp → null. */
  detect(root: string): DetectedFormat | null;
}
