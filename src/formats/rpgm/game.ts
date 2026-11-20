import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Nhận diện game RPG Maker MV/MZ – dùng chung cho mọi bộ đọc RPGM
 * (rpgm-data: data/*.json, rpgm-kns-csv: csv/*.csv, ...).
 */

export type Engine = "MV" | "MZ";

export interface RpgmGame {
  /** Thư mục người dùng chọn (chứa Game.exe). */
  root: string;
  engine: Engine;
  /** Thư mục chứa data/, js/, fonts/ (MV thường là <root>/www). */
  base: string;
  dataDir: string;
}

/** Tìm game RPGM trong thư mục; không phải game RPGM → null. */
export function findRpgm(root: string): RpgmGame | null {
  for (const base of [root, join(root, "www")]) {
    const dataDir = join(base, "data");
    if (!existsSync(join(dataDir, "System.json"))) continue;
    let engine: Engine | null = null;
    if (existsSync(join(base, "js", "rmmz_core.js"))) engine = "MZ";
    else if (existsSync(join(base, "js", "rpg_core.js"))) engine = "MV";
    if (engine) return { root, engine, base, dataDir };
  }
  return null;
}

/** Lỗi dễ hiểu khi không tìm thấy game RPGM. */
export function rpgmNotFound(root: string): Error {
  const hint = !existsSync(root)
    ? "Thư mục này không tồn tại – kiểm tra lại đường dẫn (nhớ bọc trong dấu ngoặc kép)."
    : "Không có data/System.json kèm js/rmmz_core.js hoặc js/rpg_core.js. " +
      "Có thể bạn trỏ sai thư mục, hoặc game đã bị đóng gói thành 1 file .exe.";
  return new Error(`Không tìm thấy dữ liệu RPG Maker MV/MZ.\n   Đường dẫn tool nhận được: ${root}\n   ${hint}`);
}
