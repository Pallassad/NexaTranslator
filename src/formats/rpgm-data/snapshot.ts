import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Bản sao data gốc của game, lưu trong projects/<game>/source.
 *
 * Tool LUÔN đọc chữ gốc từ bản sao này, không đọc từ data của game.
 * Nhờ vậy, dù bạn đã chép bản dịch / bản test [VI] đè vào game,
 * lần dịch sau vẫn dùng đúng chữ gốc → không bị "[VI] [VI]" hay dịch chồng lên bản dịch.
 */
export function ensureSourceSnapshot(dataDir: string, snapDir: string, refresh = false): { created: boolean } {
  if (!refresh && existsSync(join(snapDir, "System.json"))) return { created: false };
  mkdirSync(snapDir, { recursive: true });
  for (const f of readdirSync(dataDir)) {
    if (f.toLowerCase().endsWith(".json")) copyFileSync(join(dataDir, f), join(snapDir, f));
  }
  return { created: true };
}
