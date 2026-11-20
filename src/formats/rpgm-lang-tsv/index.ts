import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Entry } from "../../core/types";
import { hasLetters } from "../../core/units";
import { findRpgm } from "../rpgm/game";
import type { DetectedFormat, FormatAdapter, GamePaths, LoadedFile } from "../types";

/**
 * Bộ đọc cho game dùng tính năng đa ngôn ngữ của VisuStella MZ MessageCore: file data/Languages.tsv.
 *
 *   Key    English          Chinese(Simplified)   Chinese(Traditional)   Japanese
 *   A0001  Quest            任务                   任務                    クエスト
 *
 * Thoại trong event chỉ là mã \tl{A0001}; game tra bảng theo ngôn ngữ đang chọn.
 * VisuStella không có tiếng Việt trong danh sách ngôn ngữ → Nexa THAY CỘT ENGLISH bằng tiếng Việt,
 * trong game chọn English. Ô English trống thì dịch từ cột ngôn ngữ đầu tiên còn lại.
 */

const FILE = "Languages.tsv";
const TARGET = "English";
const MARKER = ".snapshot";

interface Table {
  /** Các dòng gốc (không kèm ký tự xuống dòng). */
  lines: string[];
  eol: string;
  bom: boolean;
  endsWithEol: boolean;
  header: string[];
  target: number;
}

function parse(text: string): Table {
  const bom = text.charCodeAt(0) === 0xfeff;
  const body = bom ? text.slice(1) : text;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const endsWithEol = body.endsWith(eol);
  const lines = (endsWithEol ? body.slice(0, -eol.length) : body).split(eol);
  const header = lines[0].split("\t");
  return { lines, eol, bom, endsWithEol, header, target: header.indexOf(TARGET) };
}

const serialize = (t: Table, lines: string[]) =>
  (t.bom ? "﻿" : "") + lines.join(t.eol) + (t.endsWithEol ? t.eol : "");

/** Ô TSV không được có tab / xuống dòng (sẽ làm lệch cột). */
const cellSafe = (s: string) => s.replace(/[\t\r\n]+/g, " ");

function load(dir: string, name: string): LoadedFile {
  const text = readFileSync(join(dir, name), "utf8");
  const t = parse(text);
  if (t.target < 0) throw new Error(`${name}: không có cột "${TARGET}"`);
  const others = t.header.map((_, i) => i).filter(i => i > 0 && i !== t.target);
  const entries: Entry[] = [];
  /** Dòng của từng entry (để ghi lại). */
  const rowOf: number[] = [];

  t.lines.forEach((line, r) => {
    if (r === 0 || !line.trim()) return;
    const cells = line.split("\t");
    const key = cells[0]?.trim();
    if (!key) return;
    const own = cells[t.target] ?? "";
    // Ô English trống → lấy chữ ở cột ngôn ngữ khác (vd tiếng Trung) để dịch
    const src = own.trim() ? own : others.map(i => cells[i] ?? "").find(c => c.trim()) ?? "";
    if (!hasLetters(src)) return;   // ô chỉ có mã (vd \i[186]) → không cần dịch
    entries.push({ file: name, path: [r, t.target], kind: "message", source: src });
    rowOf.push(r);
  });

  const build = (list: Entry[]) => {
    if (list.length !== entries.length) throw new Error(`${name}: số dòng chữ không khớp khi ghi`);
    const lines = [...t.lines];
    list.forEach((e, i) => {
      if (e.target === undefined || e.target === e.source) return;   // chưa dịch / giữ nguyên → để ô gốc
      const r = rowOf[i];
      const cells = lines[r].split("\t");
      while (cells.length <= t.target) cells.push("");
      cells[t.target] = cellSafe(e.target);
      lines[r] = cells.join("\t");
    });
    return serialize(t, lines);
  };

  return {
    name,
    entries,
    write(outPath, list) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, build(list), "utf8");
    },
    roundtripOk: () => serialize(t, t.lines) === text && build(entries) === text,
  };
}

export const rpgmLangTsv: FormatAdapter = {
  id: "rpgm-lang-tsv",
  label: "RPG Maker – Languages.tsv (VisuStella)",

  detect(root): DetectedFormat | null {
    const rpgm = findRpgm(root);
    if (!rpgm) return null;
    const file = join(rpgm.dataDir, FILE);
    if (!existsSync(file)) return null;
    // Chỉ nhận khi có cột English (cột Nexa thay bằng tiếng Việt)
    const head = readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/, 1)[0].split("\t");
    if (head[0]?.trim() !== "Key" || !head.includes(TARGET)) return null;
    const sourceDir = (p: GamePaths) => join(p.projDir, "source-lang");

    return {
      id: this.id,
      label: this.label,
      priority: 25,
      info: [`Engine: ${rpgm.engine}`, `File chữ: ${file}`, `Cột ngôn ngữ: ${head.slice(1).join(", ")}`,
        "Thay cột English → trong game chọn English"],
      files: [{ name: FILE, group: "story", hasText: true }],
      outSubdir: "data",
      note: "Game đọc chữ theo ngôn ngữ đang chọn: vào Options › Text Language chọn English để thấy bản tiếng Việt.",
      rpgm,
      sourceDir,

      snapshot(p, refresh) {
        const dir = sourceDir(p);
        if (!refresh && existsSync(join(dir, MARKER))) return { created: false };
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        copyFileSync(file, join(dir, FILE));
        writeFileSync(join(dir, MARKER), new Date().toISOString(), "utf8");
        return { created: true };
      },

      load,

      exportGroups: p => [{
        prefix: "", outDir: join(p.outDir, "data"), gameDir: rpgm.dataDir, sourceDir: sourceDir(p),
        filter: n => n === FILE, requireSource: true,
      }],
    };
  },
};
