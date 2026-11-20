import type { Entry, Kind } from "../../core/types";
import type { Group } from "./scanner";

type Path = (string | number)[];

/** Chỉ lấy chuỗi có nội dung thật (bỏ "", null, chỉ toàn khoảng trắng). */
function isText(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function push(out: Entry[], file: string, path: Path, kind: Kind, value: unknown) {
  if (isText(value)) out.push({ file, path, kind, source: value });
}

/**
 * Dòng thoại chỉ là mã tham chiếu tới chữ trong CSV (plugin KNS_CsvReader), vd "event_data_base_text_12-14".
 * Dịch mã này = game không tìm thấy thoại → tuyệt đối không đụng tới.
 */
const CSV_REF = /^\s*(?:event_data_base_text|common_database_text)_\d+(?:-\d+)?\s*$/;

/** Lấy text từ một danh sách lệnh event (Map, CommonEvents, Troops). */
function extractCommands(out: Entry[], file: string, list: any[], base: Path) {
  list.forEach((cmd, ci) => {
    const p = [...base, ci, "parameters"];
    switch (cmd.code) {
      case 401: // Show Text – 1 dòng thoại
        if (!CSV_REF.test(cmd.parameters[0] ?? "")) push(out, file, [...p, 0], "dialogue", cmd.parameters[0]);
        break;
      case 405: // Scroll Text
        push(out, file, [...p, 0], "scroll", cmd.parameters[0]);
        break;
      case 102: // Show Choices – mảng lựa chọn
        (cmd.parameters[0] as unknown[]).forEach((c, i) =>
          push(out, file, [...p, 0, i], "choice", c));
        break;
      case 101: // Show Text – MZ có tên người nói ở params[4].
        // Không dịch; chỉ lấy ra để glossary dùng (giữ nguyên tên / đổi tên chung như "Taxi Driver").
        push(out, file, [...p, 4], "speaker", cmd.parameters[4]);
        break;
      // 320/324/325 (tên nhân vật), 355/655 (script), 356/357 (plugin) → KHÔNG dịch.
    }
  });
}

function extractMap(file: string, map: any): Entry[] {
  const out: Entry[] = [];
  push(out, file, ["displayName"], "mapName", map.displayName);
  (map.events as any[]).forEach((ev, ei) => {
    if (!ev) return; // events[0] và event đã xóa luôn là null
    (ev.pages as any[]).forEach((pg, pi) =>
      extractCommands(out, file, pg.list, ["events", ei, "pages", pi, "list"]));
  });
  return out;
}

function extractCommonEvents(file: string, data: any[]): Entry[] {
  const out: Entry[] = [];
  data.forEach((ev, ei) => { if (ev) extractCommands(out, file, ev.list, [ei, "list"]); });
  return out;
}

function extractTroops(file: string, data: any[]): Entry[] {
  const out: Entry[] = [];
  data.forEach((t, ti) => {
    if (!t) return;
    (t.pages as any[]).forEach((pg, pi) =>
      extractCommands(out, file, pg.list, [ti, "pages", pi, "list"]));
  });
  return out;
}

/** Database: Items, Weapons, Armors, Skills, States, Enemies, Classes. */
function extractDatabase(file: string, data: any[], fields: [string, Kind][]): Entry[] {
  const out: Entry[] = [];
  data.forEach((row, i) => {
    if (!row) return; // phần tử [0] luôn là null
    for (const [field, kind] of fields) push(out, file, [i, field], kind, row[field]);
  });
  return out;
}

function extractSystem(file: string, s: any): Entry[] {
  const out: Entry[] = [];
  push(out, file, ["gameTitle"], "term", s.gameTitle);
  push(out, file, ["currencyUnit"], "term", s.currencyUnit);
  for (const key of ["elements", "skillTypes", "weaponTypes", "armorTypes", "equipTypes"]) {
    (s[key] as unknown[] | undefined)?.forEach((v, i) => push(out, file, [key, i], "term", v));
  }
  const t = s.terms ?? {};
  for (const key of ["basic", "commands", "params"]) {
    (t[key] as unknown[] | undefined)?.forEach((v, i) => push(out, file, ["terms", key, i], "term", v));
  }
  for (const [k, v] of Object.entries(t.messages ?? {})) push(out, file, ["terms", "messages", k], "term", v);
  // switches, variables, sounds, advanced → không đụng
  return out;
}

const NAME_DESC: [string, Kind][] = [["name", "name"], ["description", "description"]];
const SKILL_STATE: [string, Kind][] = [
  ["name", "name"], ["description", "description"],
  ["message1", "message"], ["message2", "message"], ["message3", "message"], ["message4", "message"],
];

/** Trích xuất text của 1 file theo nhóm. Trả [] cho nhóm khóa/bỏ qua. */
export function extractFile(file: string, group: Group, data: any): Entry[] {
  if (/^Map\d{3}\.json$/i.test(file)) return extractMap(file, data);
  switch (file) {
    case "CommonEvents.json": return extractCommonEvents(file, data);
    case "Troops.json": return extractTroops(file, data);
    case "System.json": return extractSystem(file, data);
  }
  switch (group) {
    case "items": return extractDatabase(file, data, NAME_DESC);
    case "skills": return extractDatabase(file, data, SKILL_STATE);
    case "enemies":
    case "classes": return extractDatabase(file, data, [["name", "name"]]);
    // Tên nhân vật: KHÔNG dịch máy – chỉ đổi theo tên đã duyệt (glossary "actors", kiểu "speaker").
    // Biệt danh / tiểu sử dịch bình thường.
    case "actors": return extractDatabase(file, data, [["name", "speaker"], ["nickname", "name"], ["profile", "description"]]);
    default: return []; // skip, other
  }
}
