import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { rpgmData } from "./rpgm-data";
import { rpgmKnsCsv } from "./rpgm-kns-csv";
import { rpgmRemLoc } from "./rpgm-rem-loc";
import { rpgmLangTsv } from "./rpgm-lang-tsv";
import type { FormatAdapter } from "./types";

/**
 * "Công cụ" = 1 thẻ ở Menu công cụ = 1 nhóm bộ đọc cho cùng 1 loại game.
 * Vd RPG Maker có 2 bộ đọc (JSON trong data/, CSV của plugin KNS) nhưng người dùng chỉ thấy 1 thẻ.
 *
 * Thêm Ren'Py: viết src/formats/renpy/, rồi thêm bộ đọc vào adapters và đổi status thành "ready".
 */
export interface ToolInfo {
  id: string;
  name: string;
  description: string;
  status: "ready" | "soon";
  /** Bộ đọc của công cụ, xếp theo ưu tiên. */
  adapters: FormatAdapter[];
}

export const TOOLS: ToolInfo[] = [
  {
    id: "rpgm",
    name: "RPG Maker MV/MZ",
    description: "Dịch thoại, vật phẩm, kỹ năng, nhiệm vụ và chữ hệ thống. Có kiểm tra font tiếng Việt và khôi phục game về bản gốc.",
    status: "ready",
    adapters: [rpgmRemLoc, rpgmLangTsv, rpgmKnsCsv, rpgmData],
  },
  { id: "renpy", name: "Ren'Py", description: "Visual novel dùng file .rpy.", status: "soon", adapters: [] },
  { id: "unity", name: "Unity", description: "Game Unity dùng file chữ trong thư mục dữ liệu.", status: "soon", adapters: [] },
];

export function getTool(id: string): ToolInfo {
  const t = TOOLS.find(x => x.id === id);
  if (!t) throw new Error(`Không có công cụ "${id}".`);
  return t;
}

/**
 * Đoán game thuộc loại nào khi công cụ hiện tại không đọc được (chỉ để gợi ý cho người dùng).
 * Kiểm tra rất nhẹ: chỉ xem tên file / thư mục ở cấp 1–2.
 */
export function guessEngine(root: string): string | null {
  if (!existsSync(root)) return null;
  let names: string[] = [];
  try { names = readdirSync(root); } catch { return null; }
  if (names.includes("game") && existsSync(join(root, "game"))) {
    try {
      if (readdirSync(join(root, "game")).some(n => /\.(rpy|rpyc|rpa)$/i.test(n))) return "Ren'Py";
    } catch { /* bỏ qua */ }
  }
  if (names.some(n => n.toLowerCase() === "unityplayer.dll" || /_Data$/.test(n))) return "Unity";
  if (names.some(n => /\.(rgss3a|rgss2a|rgssad)$/i.test(n)) || names.some(n => n.toLowerCase() === "game.ini")) {
    return "RPG Maker XP/VX/VX Ace (chưa hỗ trợ)";
  }
  return null;
}
