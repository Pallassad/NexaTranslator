import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { autoKeepNames } from "../../core/glossary";
import type { Entry } from "../../core/types";
import { findRpgm } from "../rpgm/game";
import type { DetectedFormat, FormatAdapter, GamePaths, LoadedFile } from "../types";
import { parseCsv, replaceCells } from "./csv";
import { joinCell, splitCell, type CellPieces, type Piece } from "./cells";
import { idOf, loadKnsRules, type CellRule, type FileRule } from "./rules";

/**
 * Bộ đọc cho game RPG Maker dùng plugin KNS_CsvReader (thường là game của TechnoBrake, vd NymPri).
 * Chữ của game nằm trong thư mục csv/ (thoại: sheet.csv, commonSheet.csv; vật phẩm: DB_Item.csv...),
 * còn data/*.json chỉ chứa mã tham chiếu như "event_data_base_text_12".
 */

const MARKER = ".snapshot";

/** Thư mục csv game thật sự đọc: plugin đọc "./csv" tính từ thư mục chạy game (cạnh Game.exe). */
function findCsvDir(root: string, base: string): string | null {
  for (const dir of [join(root, "csv"), join(base, "csv")]) {
    if (existsSync(join(dir, "sheet.csv")) || existsSync(join(dir, "language.csv"))) return dir;
  }
  return null;
}

/** Ô đã tách: vị trí + quy tắc + các mảnh chữ. */
interface CellInfo { r: number; rule: CellRule; cell: CellPieces; }

function loadFile(dir: string, name: string, fileRule: FileRule): LoadedFile {
  const doc = parseCsv(readFileSync(join(dir, name), "utf8"));
  const values = doc.rows.map(row => row.map(c => c.value));
  const cells: CellInfo[] = [];
  const pieceOf = new Map<Entry, Piece>();

  values.forEach((row, r) => {
    for (const rule of fileRule.cells(row, r)) {
      // Đọc cột ngôn ngữ đích; trống thì đọc cột dự phòng (tiếng Nhật)
      const own = row[rule.col] ?? "";
      const src = own.trim() ? own : rule.fallback !== undefined ? row[rule.fallback] ?? "" : "";
      if (!src.trim()) continue;
      const cell = splitCell(src, rule.mode, rule.kind, name, r, rule.col);
      if (!cell.pieces.length) continue;
      cells.push({ r, rule, cell });
      for (const p of cell.pieces) pieceOf.set(p.entry, p);
    }
  });
  const entries = cells.flatMap(c => c.cell.pieces.map(p => p.entry));
  const pieces = entries.map(e => pieceOf.get(e)!);

  /**
   * Giá trị mới của các ô (chỉ ô có ít nhất 1 mảnh thay đổi).
   * `list` là danh sách entries cùng thứ tự (có thể là bản sao kèm target).
   */
  const changes = (list: Entry[]) => {
    if (list.length !== entries.length) throw new Error(`${name}: số dòng chữ không khớp khi ghi`);
    const byPiece = new Map<Piece, Entry>(list.map((e, i) => [pieces[i], e]));
    const out = new Map<string, string>();
    for (const c of cells) {
      const targets = new Map<Piece, string | undefined>();
      let changed = false;
      for (const p of c.cell.pieces) {
        const t = byPiece.get(p)?.target;
        // Chưa dịch hoặc giữ nguyên → dùng đúng chữ gốc trong file (giữ cả "\,")
        const use = t === undefined || t === p.entry.source ? undefined : t;
        if (use !== undefined) changed = true;
        targets.set(p, use);
      }
      if (changed) out.set(`${c.r},${c.rule.col}`, joinCell(c.cell, c.rule.mode, targets));
    }
    return out;
  };

  return {
    name,
    entries,
    write(outPath, list) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, replaceCells(doc, changes(list)), "utf8");
    },
    roundtripOk() {
      // Ghép lại từ chữ gốc phải ra đúng ô gốc, và ghi lại không đổi gì phải ra đúng file gốc
      const sameCells = cells.every(c => {
        const own = values[c.r][c.rule.col] ?? "";
        const src = own.trim() ? own : values[c.r][c.rule.fallback ?? -1] ?? "";
        return joinCell(c.cell, c.rule.mode, new Map()) === src;
      });
      return sameCells && replaceCells(doc, new Map()) === doc.text;
    },
  };
}

export const rpgmKnsCsv: FormatAdapter = {
  id: "rpgm-kns-csv",
  label: "RPG Maker – CSV (plugin KNS_CsvReader)",

  detect(root): DetectedFormat | null {
    const rpgm = findRpgm(root);
    if (!rpgm) return null;
    const csvDir = findCsvDir(root, rpgm.base);
    if (!csvDir) return null;
    const kns = loadKnsRules(rpgm.base, csvDir);
    if (!kns) return null;

    const ruleOf = new Map(kns.rules.map(r => [r.file.toLowerCase(), r]));
    const names = readdirSync(csvDir).filter(f => f.toLowerCase().endsWith(".csv")).sort();
    const sourceDir = (p: GamePaths) => join(p.projDir, "source-csv");
    const ruleFor = (name: string) => {
      const r = ruleOf.get(name.toLowerCase());
      if (!r) throw new Error(`${name} không có chữ cần dịch`);
      return r;
    };

    return {
      id: this.id,
      label: this.label,
      // Game dùng KNS: chữ thật nằm trong CSV → ưu tiên hơn data/*.json
      priority: 20,
      info: [
        `Plugin: KNS_CsvReader ver.${kns.version}`,
        `Thư mục csv: ${csvDir}`,
        `Ngôn ngữ thay bằng tiếng Việt: cột "${kns.langName}" → trong game chọn ngôn ngữ ${kns.langName === "en" ? "English" : kns.langName}`,
      ],
      files: names.map(name => {
        const r = ruleOf.get(name.toLowerCase());
        return { name, group: r?.group ?? "skip", hasText: Boolean(r), optional: r?.optional };
      }),
      outSubdir: "csv",
      note: `Game đọc chữ theo ngôn ngữ đang chọn: vào Option/Language của game chọn ` +
        `${kns.langName === "en" ? "English" : kns.langName} để thấy bản tiếng Việt.`,
      rpgm,
      sourceDir,

      snapshot(p, refresh) {
        const dir = sourceDir(p);
        if (!refresh && existsSync(join(dir, MARKER))) return { created: false };
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        for (const f of names) copyFileSync(join(csvDir, f), join(dir, f));
        writeFileSync(join(dir, MARKER), new Date().toISOString(), "utf8");
        return { created: true };
      },

      load: (dir, name) => loadFile(dir, name, ruleFor(name)),

      exportGroups: p => [{
        prefix: "csv/", outDir: join(p.outDir, "csv"), gameDir: csvDir, sourceDir: sourceDir(p),
        filter: n => n.toLowerCase().endsWith(".csv"), requireSource: true,
      }],

      actorNames(dir) {
        const out: { id: number; name: string }[] = [];
        for (const r of kns.rules) {
          if (!r.actorCol || !existsSync(join(dir, r.file))) continue;
          const rows = parseCsv(readFileSync(join(dir, r.file), "utf8")).rows;
          rows.forEach(row => {
            const vals = row.map(c => c.value);
            const id = idOf(vals);
            const name = (vals[r.actorCol!.col]?.trim() || vals[r.actorCol!.fallback]?.trim()) ?? "";
            if (id > 0 && name) out.push({ id, name });
          });
        }
        return out;
      },

      keepNames(dir) {
        const names: { name: string }[] = [];
        for (const r of kns.rules) {
          if (r.keepCol === undefined || !existsSync(join(dir, r.file))) continue;
          const rows = parseCsv(readFileSync(join(dir, r.file), "utf8")).rows;
          rows.forEach((row, i) => { if (i > 0) names.push({ name: row[r.keepCol!]?.value ?? "" }); });
        }
        return autoKeepNames(names);
      },
    };
  },
};
