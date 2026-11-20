import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { readJson, writeJson } from "./writer";

/**
 * Chép bản dịch vào game / khôi phục bản gốc một cách AN TOÀN.
 *
 * Mỗi file chỉ bị ghi đè khi nội dung hiện tại trong game là:
 *   - bản GỐC (giống bản chép trong projects/<game>/source...), hoặc
 *   - bản do CHÍNH TOOL xuất lần trước (lưu hash trong export.json).
 * File bị thay đổi bởi thứ khác (game cập nhật, mod khác, sửa tay...) → "xung đột", bỏ qua,
 * trừ khi dùng --force (khi đó file hiện tại được backup trước khi ghi đè).
 */

/** Hash đặc biệt: file KHÔNG có trong game gốc (vd file font mới). */
export const ABSENT = "absent";

export interface ExportRecord {
  /** Tên file; file ngoài data/ có tiền tố, vd "fonts/BeVietnamPro-Regular.ttf". */
  name: string;
  original: string;
  exported: string;
}

export interface Manifest {
  dataDir: string;
  exportedAt: string;
  files: ExportRecord[];
}

/** Một nhóm file: thư mục trong output ↔ thư mục trong game ↔ thư mục chứa bản gốc. */
export interface FileGroup {
  /** "" cho data/, "fonts/" cho fonts/ */
  prefix: string;
  outDir: string;
  gameDir: string;
  sourceDir: string;
  /** Chỉ lấy file thỏa điều kiện (mặc định: tất cả). */
  filter?: (name: string) => boolean;
  /**
   * true: file nào cũng phải có bản gốc (data/, csv/...).
   * false: không có bản gốc = file MỚI thêm vào game (vd font) → restore sẽ xóa.
   * Mặc định: true khi prefix "" (data/), false với nhóm khác.
   */
  requireSource?: boolean;
}

export type FileStatus = "new" | "update" | "same" | "conflict" | "missing-source";
export interface FileResult { name: string; status: FileStatus; written: boolean; backup?: string; }

const sha1 = (path: string) => createHash("sha1").update(readFileSync(path)).digest("hex");
const hashIfExists = (path: string) => (existsSync(path) ? sha1(path) : null);

export function loadManifest(path: string): Manifest | null {
  return existsSync(path) ? (readJson(path) as Manifest) : null;
}

/** Thư mục backup theo thời gian: projects/<game>/backup/2026-11-18-21-30-05 */
function backupDir(projDir: string): string {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\..+$/, "");
  return join(projDir, "backup", stamp);
}

export interface ExportOptions {
  projDir: string;      // projects/<game> – chứa export.json, backup/
  /**
   * Các nhóm file cần export/restore (data/, csv/, fonts/...).
   * Restore cần TẤT CẢ nhóm từng export để khôi phục đúng chỗ.
   * Không truyền → dùng cách cũ: outDataDir/gameDataDir/sourceDir + extra.
   */
  groups?: FileGroup[];
  outDataDir?: string;   // output/<game>/data
  gameDataDir?: string;  // <game>/data hoặc <game>/www/data
  sourceDir?: string;    // projects/<game>/source (bản gốc)
  /** Nhóm file khác ngoài data/ (vd fonts/). */
  extra?: FileGroup[];
  force?: boolean;
  dryRun?: boolean;
}

function groupsOf(opt: ExportOptions): FileGroup[] {
  if (opt.groups) return opt.groups;
  return [
    { prefix: "", outDir: opt.outDataDir ?? "", gameDir: opt.gameDataDir ?? "", sourceDir: opt.sourceDir ?? "", filter: n => n.toLowerCase().endsWith(".json") },
    ...(opt.extra ?? []),
  ];
}

const requiresSource = (g: FileGroup) => g.requireSource ?? g.prefix === "";

/** Chép bản dịch vào game. */
export function exportToGame(opt: ExportOptions): FileResult[] {
  const manifestPath = join(opt.projDir, "export.json");
  const prev = loadManifest(manifestPath);
  const prevByName = new Map(prev?.files.map(f => [f.name, f]) ?? []);
  const records = new Map(prevByName);
  const results: FileResult[] = [];
  let bdir: string | null = null;

  for (const g of groupsOf(opt)) {
    if (!existsSync(g.outDir)) continue;
    for (const file of readdirSync(g.outDir).filter(n => !g.filter || g.filter(n))) {
      const name = g.prefix + file;
      const outFile = join(g.outDir, file);
      const gameFile = join(g.gameDir, file);
      const srcFile = join(g.sourceDir, file);
      // data/, csv/: bắt buộc có bản gốc. Nhóm khác (fonts/): không có bản gốc = file mới thêm vào game.
      const original = hashIfExists(srcFile) ?? (requiresSource(g) ? null : ABSENT);
      const current = hashIfExists(gameFile);
      const translated = sha1(outFile);
      const before = prevByName.get(name);

      if (!original) { results.push({ name, status: "missing-source", written: false }); continue; }
      if (current === translated) {
        results.push({ name, status: "same", written: false });
        records.set(name, { name, original, exported: translated });
        continue;
      }

      let status: FileStatus;
      const isOriginal = current === original || (original === ABSENT && current === null);
      if (isOriginal) status = before ? "update" : "new";
      else if (before && current === before.exported) status = "update";
      else status = "conflict";

      let backup: string | undefined;
      const allowed = status !== "conflict" || Boolean(opt.force);
      if (allowed && !opt.dryRun) {
        if (status === "conflict" && current) {
          bdir ??= backupDir(opt.projDir);
          backup = join(bdir, name);
          mkdirSync(dirname(backup), { recursive: true });
          copyFileSync(gameFile, backup);
        }
        mkdirSync(g.gameDir, { recursive: true });
        copyFileSync(outFile, gameFile);
        records.set(name, { name, original, exported: translated });
      }
      results.push({ name, status, written: allowed && !opt.dryRun, backup });
    }
  }

  if (!opt.dryRun) {
    writeJson(manifestPath, {
      dataDir: opt.gameDataDir ?? "", exportedAt: new Date().toISOString(), files: [...records.values()],
    } satisfies Manifest, true);
  }
  return results;
}

export type RestoreStatus = "restored" | "already-original" | "conflict" | "missing-source";
export interface RestoreResult { name: string; status: RestoreStatus; written: boolean; backup?: string; }

/** Đưa các file tool đã chép vào game về lại bản gốc (file mới thêm vào thì bị xóa). */
export function restoreGame(opt: ExportOptions): RestoreResult[] {
  const manifestPath = join(opt.projDir, "export.json");
  const manifest = loadManifest(manifestPath);
  if (!manifest || manifest.files.length === 0) return [];
  const groups = groupsOf(opt).sort((a, b) => b.prefix.length - a.prefix.length);
  const results: RestoreResult[] = [];
  const remaining: ExportRecord[] = [];
  let bdir: string | null = null;

  for (const rec of manifest.files) {
    const g = groups.find(x => rec.name.startsWith(x.prefix));
    if (!g) { remaining.push(rec); continue; } // nhóm không được truyền vào → giữ nguyên bản ghi
    const file = rec.name.slice(g.prefix.length);
    const gameFile = join(g.gameDir, file);
    const srcFile = join(g.sourceDir, file);
    const absent = rec.original === ABSENT;
    if (!absent && !existsSync(srcFile)) {
      results.push({ name: rec.name, status: "missing-source", written: false });
      remaining.push(rec);
      continue;
    }
    const current = hashIfExists(gameFile);

    if (current === rec.original || (absent && current === null)) {
      results.push({ name: rec.name, status: "already-original", written: false });
      continue;
    }
    const status: RestoreStatus = current === rec.exported ? "restored" : "conflict";
    const allowed = status === "restored" || Boolean(opt.force);
    let backup: string | undefined;
    if (allowed && !opt.dryRun) {
      if (status === "conflict" && current) {
        bdir ??= backupDir(opt.projDir);
        backup = join(bdir, rec.name);
        mkdirSync(dirname(backup), { recursive: true });
        copyFileSync(gameFile, backup);
      }
      if (absent) rmSync(gameFile, { force: true });
      else copyFileSync(srcFile, gameFile);
    } else {
      remaining.push(rec);
    }
    results.push({ name: rec.name, status, written: allowed && !opt.dryRun, backup });
  }

  if (!opt.dryRun) writeJson(manifestPath, { ...manifest, files: remaining } satisfies Manifest, true);
  return results;
}
