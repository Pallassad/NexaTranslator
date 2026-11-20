import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { applyEntries, readJson, writeJson } from "../../core/writer";
import type { Entry, Kind } from "../../core/types";
import { CODE } from "../../core/protect";
import { findRpgm } from "../rpgm/game";
import type {
  DetectedFormat,
  FormatAdapter,
  FormatFile,
  GamePaths,
} from "../types";

/**
 * Bộ đọc cho game dùng hệ thống chữ của Remtairy: thư mục www/loc/.
 *
 *  - RemMap_EN.json   { key: { text: [dòng...] } }   thoại / cốt truyện (event gọi bằng \REM_MAP[key])
 *  - RemDesc_EN.json  { key: { text: [dòng...] } }   tên + mô tả kỹ năng, trang bị, trạng thái... (\REM_DESC[key])
 *  - RemEff.json      { key: { text: [dòng...] } }   hiệu ứng (phần lớn chỉ trỏ sang RemDesc)
 *  - RemLines.json    { key: { en: [...], jp: [...] } } câu thoại nhân vật chính trong trận (chỉ dịch "en")
 *
 * Game chọn file theo ngôn ngữ đang đặt → Nexa thay chữ TIẾNG ANH bằng tiếng Việt, trong game chọn English.
 * Bản dịch của game sang tiếng khác (_JP, _SCH, _KR...) không bị đụng tới.
 * Dữ liệu trong data/*.json của game này phần lớn chỉ là mã tham chiếu (\REM_MAP[...]) → dùng bộ đọc rpgm-data nếu cần.
 */

interface LocFile {
  name: string;
  group: string;
  /** Mảng dòng của 1 khóa nằm ở trường nào. */
  field: "text" | "en";
  /** Thoại thường: gộp + ngắt dòng lại theo khung thoại. Còn lại: giữ đúng số dòng gốc. */
  dialogue: boolean;
}

const FILES: LocFile[] = [
  { name: "RemMap_EN.json", group: "story", field: "text", dialogue: true },
  { name: "RemLines.json", group: "story", field: "en", dialogue: false },
  { name: "RemDesc_EN.json", group: "desc", field: "text", dialogue: false },
  { name: "RemEff.json", group: "desc", field: "text", dialogue: false },
];

const MARKER = ".snapshot";

/** Dòng có chữ thật (bỏ mã điều khiển vẫn còn chữ cái / số) – dòng chỉ có mã như \REM_DESC[x] hay \fb\C[5]"" thì bỏ qua. */
function hasText(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s.replace(CODE, ""));
}

/** Loại chữ theo tên khóa (RemDesc): *_name → tên, actor_N_name → tên nhân vật (chỉ đổi theo glossary). */
function kindOf(file: LocFile, key: string): Kind {
  if (file.dialogue) return "dialogue";
  if (/^actor_\d+_name$/.test(key)) return "speaker";
  if (/_name$/.test(key)) return "name";
  if (/_msg\d*$/.test(key)) return "message";
  return "description";
}

function extract(file: LocFile, data: Record<string, any>): Entry[] {
  const out: Entry[] = [];
  for (const [key, val] of Object.entries(data)) {
    const lines = val?.[file.field];
    if (!Array.isArray(lines)) continue;
    const kind = kindOf(file, key);
    const textLines = lines
      .map((l, i) => [l, i] as const)
      .filter(([l]) => typeof l === "string" && hasText(l));
    for (const [line, i] of textLines) {
      const path = [key, file.field, i];
      if (
        kind === "dialogue" ||
        (textLines.length > 1 && kind !== "speaker" && kind !== "name")
      ) {
        // Nhiều dòng = 1 câu → gộp để dịch (mô tả / thoại trận: giữ đúng số dòng)
        out.push({
          file: file.name,
          path,
          kind: "dialogue",
          source: line,
          block: key,
          ...(file.dialogue ? { fillLines: true } : { fixedLines: true }),
        });
      } else {
        out.push({ file: file.name, path, kind, source: line });
      }
    }
  }
  return out;
}

export const rpgmRemLoc: FormatAdapter = {
  id: "rpgm-rem-loc",
  label: "RPG Maker – Loc ",

  detect(root): DetectedFormat | null {
    const rpgm = findRpgm(root);
    if (!rpgm) return null;
    const locDir = join(rpgm.base, "loc");
    if (
      !existsSync(join(locDir, "RemMap_EN.json")) &&
      !existsSync(join(locDir, "RemDesc_EN.json"))
    )
      return null;
    const present = FILES.filter((f) => existsSync(join(locDir, f.name)));
    const sourceDir = (p: GamePaths) => join(p.projDir, "source-loc");

    return {
      id: this.id,
      label: this.label,
      priority: 30,
      info: [
        `Engine: ${rpgm.engine}`,
        `Thư mục chữ: ${locDir}`,
        `Thay chữ tiếng Anh → trong game chọn English`,
      ],
      files: present.map(
        (f): FormatFile => ({ name: f.name, group: f.group, hasText: true }),
      ),
      outSubdir: "loc",
      note: "Game đọc chữ theo ngôn ngữ đang chọn: vào Options của game chọn English để thấy bản tiếng Việt.",
      rpgm,
      sourceDir,

      snapshot(p, refresh) {
        const dir = sourceDir(p);
        if (!refresh && existsSync(join(dir, MARKER)))
          return { created: false };
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        for (const f of present)
          copyFileSync(join(locDir, f.name), join(dir, f.name));
        writeFileSync(join(dir, MARKER), new Date().toISOString(), "utf8");
        return { created: true };
      },

      load(dir, name) {
        const file = FILES.find((f) => f.name === name);
        if (!file) throw new Error(`${name} không phải file chữ của game này`);
        const data = readJson(join(dir, name));
        const entries = extract(file, data);
        return {
          name,
          entries,
          write: (outPath, list) =>
            writeJson(outPath, applyEntries(structuredClone(data), list)),
          roundtripOk: () =>
            isDeepStrictEqual(
              applyEntries(structuredClone(data), entries),
              data,
            ),
        };
      },

      // Chỉ chép đúng các file Nexa dịch – không đụng file ngôn ngữ khác trong loc/
      exportGroups: (p) => [
        {
          prefix: "loc/",
          outDir: join(p.outDir, "loc"),
          gameDir: locDir,
          sourceDir: sourceDir(p),
          filter: (n) => present.some((f) => f.name === n),
          requireSource: true,
        },
      ],
    };
  },
};
