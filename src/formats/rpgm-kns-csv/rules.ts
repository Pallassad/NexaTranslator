import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Kind } from "../../core/types";
import { columnIndex } from "./csv";

/**
 * Quy tắc "file nào, dòng nào, cột nào là chữ" cho game dùng plugin KNS_CsvReader.
 *
 * Plugin chọn ngôn ngữ bằng biến 1 (0 = tiếng Nhật, 1 = tiếng Anh...). Mỗi file có 1 cột riêng cho từng
 * ngôn ngữ, vị trí tính theo: cột = start + field + pad × ngôn_ngữ.
 *
 * Cách dịch: đọc cột ngôn ngữ đích của plugin (mặc định tiếng Anh; ô trống thì đọc cột tiếng Nhật),
 * ghi bản dịch đè vào CHÍNH cột đó → trong game chọn English là thấy tiếng Việt.
 *
 * Phần lớn quy tắc được đọc trực tiếp từ file KNS_CsvReader.js của game (bảng `databases`),
 * nên game khác dùng cùng plugin nhưng xếp cột khác vẫn đúng.
 */

/** Cách tách chữ trong 1 ô. */
export type CellMode =
  | "plain"     // cả ô là 1 đoạn chữ (tên, mô tả...), giữ nguyên số dòng
  | "message"   // ô thoại: dòng 1 có thể là nhãn người nói, các dòng kết thúc bằng "/" (sheet, commonSheet)
  | "progress"; // tiến độ nhiệm vụ: mỗi dòng "$progressN=chữ"

export interface CellRule {
  /** Cột đọc chữ gốc và ghi bản dịch. */
  col: number;
  /** Cột dự phòng khi ô trên trống (tiếng Nhật). */
  fallback?: number;
  kind: Kind;
  mode: CellMode;
}

export interface FileRule {
  file: string;
  group: string;
  /** Không dịch nếu không chọn rõ bằng --files (vd tên biến chỉ hiện ở màn hình debug). */
  optional?: boolean;
  /** Cột chứa tên nhân vật (giữ nguyên, đưa vào glossary). */
  keepCol?: number;
  /** Bảng nhân vật (DB_Actor): cột tên theo ngôn ngữ đích + cột dự phòng (tiếng Nhật). */
  actorCol?: { col: number; fallback: number };
  /** Các ô cần dịch của 1 dòng ([] = bỏ qua dòng). */
  cells(row: string[], index: number): CellRule[];
}

export interface KnsInfo {
  version: string;
  /** Chỉ số ngôn ngữ được thay bằng tiếng Việt (mặc định: tiếng Anh). */
  lang: number;
  langName: string;
  rules: FileRule[];
}

const RE_ID = /^\$id=(\d+)/;
export const idOf = (row: string[]) => Number(row[0]?.match(RE_ID)?.[1] ?? 0);

/** Đọc danh sách plugin đang bật trong js/plugins.js. */
export function readPlugins(base: string): { name: string; status: boolean; parameters: Record<string, string> }[] {
  const path = join(base, "js", "plugins.js");
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  } catch {
    return [];
  }
}

/** Ngôn ngữ thay bằng tiếng Việt: dòng "en" trong csv/language.csv, không có thì 1. */
function pickLanguage(csvDir: string): { lang: number; name: string } {
  const path = join(csvDir, "language.csv");
  if (existsSync(path)) {
    const list = readFileSync(path, "utf8").replace(/\r/g, "").split("\n").map(s => s.split(",")[0].trim().toLowerCase());
    const en = list.findIndex(s => s === "en" || s === "eng" || s === "english");
    if (en > 0) return { lang: en, name: list[en] };
  }
  return { lang: 1, name: "en" };
}

/** Kiểu chữ của 1 trường cơ sở dữ liệu. */
const fieldKind = (field: string): Kind => (field === "description" ? "description" : "name");

/**
 * Đọc bảng `this.databases = [...]` trong KNS_CsvReader.js:
 *   ["DB_Item", this.onLoadObject.bind(this, "$dataItems", [["name", 0], ["description", 1]], 2, 2)],
 */
function parseObjectTables(src: string) {
  const re = /\[\s*"(\w+)"\s*,\s*this\.onLoadObject\.bind\(\s*this\s*,\s*"(\$\w+)"\s*,\s*\[((?:\s*\[\s*"\w+"\s*,\s*\d+\s*\]\s*,?)*)\s*\]\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*\]/g;
  const out: { file: string; table: string; fields: { name: string; index: number }[]; start: number; pad: number }[] = [];
  for (const m of src.matchAll(re)) {
    const fields = [...m[3].matchAll(/\[\s*"(\w+)"\s*,\s*(\d+)\s*\]/g)].map(f => ({ name: f[1], index: Number(f[2]) }));
    out.push({ file: m[1], table: m[2], fields, start: Number(m[4]), pad: Number(m[5]) });
  }
  return out;
}

const GROUP: Record<string, string> = {
  $dataActors: "actors", $dataClasses: "classes", $dataStates: "skills", $dataItems: "items",
  $dataWeapons: "items", $dataArmors: "items", $dataSkills: "skills", $dataEnemies: "enemies",
};

/** Nhận diện plugin KNS_CsvReader và tạo quy tắc cho từng file. Không phải game KNS → null. */
export function loadKnsRules(base: string, csvDir: string): KnsInfo | null {
  const plugins = readPlugins(base);
  const kns = plugins.find(p => p?.name === "KNS_CsvReader" && p.status);
  const pluginPath = join(base, "js", "plugins", "KNS_CsvReader.js");
  if (!kns || !existsSync(pluginPath)) return null;

  const src = readFileSync(pluginPath, "utf8");
  const version = src.match(/@plugindesc\s+ver\.?\s*([\d.]+)/)?.[1] ?? "?";
  const { lang, name: langName } = pickLanguage(csvDir);
  const has = (handler: string) => new RegExp(`this\\.${handler}\\.bind`).test(src);
  const active = (name: string) => plugins.some(p => p?.name === name && p.status);
  const rules: FileRule[] = [];

  // ---- Cơ sở dữ liệu: DB_Item, DB_Skill... (đọc trực tiếp từ plugin) ----
  for (const t of parseObjectTables(src)) {
    const isActor = t.table === "$dataActors";
    const col = (f: number, l: number) => t.start + f + t.pad * l;
    const nameField = t.fields.find(f => f.name === "name");
    rules.push({
      file: `${t.file}.csv`,
      group: GROUP[t.table] ?? "other",
      // Tên nhân vật giữ nguyên (giống Actors.json ở chế độ data)
      keepCol: isActor && nameField ? col(nameField.index, lang) : undefined,
      actorCol: isActor && nameField ? { col: col(nameField.index, lang), fallback: col(nameField.index, 0) } : undefined,
      // Tên nhân vật (kiểu "speaker"): không dịch máy, chỉ đổi theo tên đã duyệt trong glossary
      cells: row => idOf(row) > 0
        ? t.fields.map(f => ({
          col: col(f.index, lang), fallback: col(f.index, 0),
          kind: isActor && f.name === "name" ? "speaker" as const : fieldKind(f.name), mode: "plain" as const,
        }))
        : [],
    });
  }

  // ---- Các bảng có cách đọc riêng trong plugin ----
  if (has("onLoadVariables")) {
    // Tên biến: chỉ hiện ở màn hình debug → mặc định không dịch
    rules.push({
      file: "DB_Variable.csv", group: "system", optional: true,
      cells: row => (idOf(row) > 0 ? [{ col: 1 + lang, fallback: 1, kind: "term", mode: "plain" }] : []),
    });
  }
  if (has("onLoadLogSheet")) {
    rules.push({
      file: "logsheet.csv", group: "system",
      cells: (row, i) => (i > 0 && row[0]?.trim() ? [{ col: 1 + lang, fallback: 1, kind: "message", mode: "plain" }] : []),
    });
  }
  if (has("onLoadQuestList")) {
    // translate(csv, 6, i, 7): title, map_name, client, rewards, progress, short_desc, long_desc
    rules.push({
      file: "QuestList.csv", group: "quest",
      cells: row => {
        const m = row[0]?.match(/^\$quest_id=(\d+)/);
        if (!m) return [];
        const id = Number(m[1]);
        const col = (i: number, l: number) => 6 + i + 7 * l;
        const out: CellRule[] = [];
        for (let i = 0; i < 7; i++) {
          // id 0 = chữ hệ thống (nhãn); id khác: phần thưởng là mã ($I1X2...) → bỏ qua
          if (id !== 0 && i === 3) continue;
          const mode = id !== 0 && i === 4 ? "progress" : "plain";
          out.push({ col: col(i, lang), fallback: col(i, 0), kind: i >= 5 ? "description" : "name", mode });
        }
        return out;
      },
    });
  }
  for (const [handler, file] of [["onLoadSheet", "sheet.csv"], ["onLoadCommons", "commonSheet.csv"]] as const) {
    if (!has(handler)) continue;
    // getEventMessage: translate(csv, 2, 0, 1) – dòng "$textN"
    rules.push({
      file, group: "story",
      cells: row => (/^\$text\d+/.test(row[0] ?? "") ? [{ col: 2 + lang, fallback: 2, kind: "dialogue", mode: "message" }] : []),
    });
  }
  if (has("onLoadProfile")) {
    // getProfileTerm: translate(item.slice(1), 1, 0, 1) → cột 2 + ngôn ngữ
    rules.push({
      file: "profile.csv", group: "npc",
      cells: row => (row[0]?.trim() ? [{ col: 2 + lang, fallback: 2, kind: "description", mode: "plain" }] : []),
    });
  }
  if (has("onLoadNPC")) {
    // KNS_NpcData: cột tên / hồ sơ khai báo trong tham số plugin (mặc định E, J) + ngôn ngữ
    const params = plugins.find(p => p?.name === "KNS_NpcData")?.parameters ?? {};
    const rowOf = (json: string | undefined, def: string) => {
      try { return columnIndex(JSON.parse(json ?? "{}").row ?? def); } catch { return columnIndex(def); }
    };
    const nameCol = rowOf(params.name_row, "E");
    const profileCol = rowOf(params.profile_row, "J");
    rules.push({
      file: "DB_NPC.csv", group: "npc", keepCol: nameCol + lang,
      cells: (_row, i) => (i > 0 ? [{ col: profileCol + lang, fallback: profileCol, kind: "description", mode: "plain" }] : []),
    });
  }

  // ---- File do plugin khác đọc ----
  if (active("TB_EroWindow") || active("Test_ProfileWindow")) {
    // key, jp, en – plugin tách dòng trước khi đọc → bản dịch không được có xuống dòng (giữ số dòng như gốc)
    rules.push({
      file: "EroWindowText.csv", group: "system",
      cells: (row, i) => (i > 0 && row[0]?.trim() ? [{ col: 2, fallback: 1, kind: "term", mode: "plain" }] : []),
    });
  }
  if (active("TB_NPCWindow")) {
    // id, jp, en – cột = 1 + ngôn ngữ
    rules.push({
      file: "DB_NPCJob.csv", group: "npc",
      cells: row => (row[0]?.trim() ? [{ col: 1 + lang, fallback: 1, kind: "name", mode: "plain" }] : []),
    });
  }
  // Mảng dữ liệu "thô" (plugin khác dùng, không rõ cột nào) → chỉ dịch khi chọn rõ
  rules.push(
    {
      file: "status.csv", group: "system", optional: true,
      cells: row => (row[0]?.trim() ? [{ col: 2, fallback: 1, kind: "term", mode: "plain" }] : []),
    },
    {
      file: "window_ero_status_simple.csv", group: "system", optional: true,
      cells: row => (row[0]?.trim() ? [{ col: 1, kind: "term", mode: "plain" }] : []),
    },
  );

  return { version, lang, langName, rules };
}
