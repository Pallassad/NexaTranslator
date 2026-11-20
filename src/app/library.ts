import { basename, join, resolve } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readJson, writeJson } from "../core/writer";
import { detectFormats } from "../formats/registry";
import { findRpgm } from "../formats/rpgm/game";
import { getTool, guessEngine } from "../formats/tools";
import type { AppContext } from "./context";
import { readProgress } from "./translate";

/**
 * Thư viện game: danh sách game người dùng đã thêm, lưu ở <workDir>/library.json.
 * Thêm / xóa khỏi thư viện KHÔNG đụng vào thư mục game, bản dịch hay memory.
 */

export interface LibraryEntry {
  id: string;
  /** Công cụ (vd "rpgm"). */
  tool: string;
  /** Thư mục game (đường dẫn tuyệt đối). */
  root: string;
  /** Tên thư mục game – cũng là tên thư mục trong output/ và projects/. */
  name: string;
  /** Định dạng người dùng chọn; không có → định dạng ưu tiên nhất. */
  format?: string;
  addedAt: number;
  openedAt: number;
}

interface LibraryFile {
  version: 1;
  games: LibraryEntry[];
}

/** Thông tin 1 thẻ game (đọc từ dữ liệu thật, không đoán). */
export interface GameCard extends LibraryEntry {
  /** Thư mục game còn tồn tại không (ổ cứng rút ra, game bị xóa...). */
  available: boolean;
  engine?: "MV" | "MZ";
  /** Định dạng game dùng (id + nhãn), xếp theo ưu tiên. */
  formats: { id: string; label: string }[];
  /** Ảnh icon/icon.png của game, nếu có. */
  iconPath?: string;
  /**
   * Tiến độ theo progress.json của lần dịch gần nhất (số dòng đã dịch / số dòng).
   * undefined = chưa dịch lần nào.
   */
  progress?: { translated: number; lines: number; kept: number };
  /** Đã chép bản dịch vào game (export.json còn file). */
  exported: boolean;
}

const libPath = (ctx: AppContext) => join(ctx.workDir, "library.json");

function load(ctx: AppContext): LibraryFile {
  const p = libPath(ctx);
  if (!existsSync(p)) return { version: 1, games: [] };
  try {
    const data = readJson(p) as LibraryFile;
    return Array.isArray(data?.games) ? data : { version: 1, games: [] };
  } catch {
    return { version: 1, games: [] };
  }
}

function save(ctx: AppContext, lib: LibraryFile) {
  writeJson(libPath(ctx), lib, true);
}

const sameRoot = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

/** Danh sách game của 1 công cụ, kèm thông tin để vẽ thẻ. */
export function listGames(ctx: AppContext, tool: string): GameCard[] {
  return load(ctx).games.filter(g => g.tool === tool).map(g => describeGame(ctx, g));
}

export function getGame(ctx: AppContext, id: string): LibraryEntry {
  const g = load(ctx).games.find(x => x.id === id);
  if (!g) throw new Error("Game này không còn trong thư viện.");
  return g;
}

export function describeGame(ctx: AppContext, g: LibraryEntry): GameCard {
  const available = existsSync(g.root);
  const card: GameCard = { ...g, available, formats: [], exported: false };
  if (!available) return card;

  try {
    const formats = detectFormats(g.root, getTool(g.tool).adapters);
    card.formats = formats.map(f => ({ id: f.id, label: f.label }));
    const rpgm = formats.find(f => f.rpgm)?.rpgm ?? findRpgm(g.root) ?? undefined;
    card.engine = rpgm?.engine;
    const icon = rpgm ? join(rpgm.base, "icon", "icon.png") : undefined;
    if (icon && existsSync(icon)) card.iconPath = icon;
  } catch {
    // Game đổi cấu trúc sau khi thêm → vẫn hiện thẻ, mở ra sẽ báo lỗi cụ thể
  }

  // Tiến độ: progress.json của định dạng đang dùng (không có thì của định dạng bất kỳ)
  const reports = join(ctx.workDir, "output", g.name, "reports");
  const fmtId = g.format ?? card.formats[0]?.id;
  const candidates = [fmtId, ...(existsSync(reports) ? readdirSync(reports) : [])].filter(Boolean) as string[];
  for (const id of candidates) {
    const p = join(reports, id, "progress.json");
    if (!existsSync(p)) continue;
    const rows = [...readProgress(p).values()];
    if (!rows.length) continue;
    card.progress = {
      lines: rows.reduce((n, r) => n + r.lines, 0),
      translated: rows.reduce((n, r) => n + r.translated, 0),
      kept: rows.reduce((n, r) => n + r.kept, 0),
    };
    break;
  }

  const manifest = join(ctx.workDir, "projects", g.name, "export.json");
  if (existsSync(manifest)) {
    try { card.exported = ((readJson(manifest) as { files?: unknown[] }).files?.length ?? 0) > 0; } catch { /* bỏ qua */ }
  }
  return card;
}

export class AddGameError extends Error {
  constructor(message: string, readonly guess?: string | null) {
    super(message);
  }
}

/**
 * Thêm game vào thư viện (chỉ đọc thư mục game, không ghi gì vào đó).
 * Không phải game của công cụ này → AddGameError kèm đoán loại game (nếu đoán được).
 */
export function addGame(ctx: AppContext, tool: string, root: string): GameCard {
  root = resolve(root.trim().replace(/^"+|"+$/g, ""));
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new AddGameError("Thư mục này không tồn tại.");
  const t = getTool(tool);
  let formats;
  try {
    formats = detectFormats(root, t.adapters);
  } catch {
    const guess = guessEngine(root);
    throw new AddGameError(
      guess ? `Đây không phải game ${t.name}. Thư mục này giống game ${guess}.`
        : `Không tìm thấy dữ liệu ${t.name} trong thư mục này. Có thể bạn chọn nhầm thư mục, hoặc game đã bị đóng gói thành 1 file .exe.`,
      guess);
  }

  const lib = load(ctx);
  const existing = lib.games.find(g => sameRoot(g.root, root));
  if (existing) return describeGame(ctx, existing);

  // output/ và projects/ đặt tên theo thư mục game → 2 game trùng tên thư mục sẽ dùng chung dữ liệu
  const name = basename(root);
  const clash = lib.games.find(g => g.name.toLowerCase() === name.toLowerCase());
  if (clash) {
    throw new AddGameError(`Đã có game khác cùng tên thư mục "${name}" (${clash.root}). Đổi tên một trong hai thư mục rồi thêm lại.`);
  }

  const now = Date.now();
  const entry: LibraryEntry = {
    id: `${tool}-${now.toString(36)}`, tool, root, name,
    format: formats[0].id, addedAt: now, openedAt: now,
  };
  lib.games.push(entry);
  save(ctx, lib);
  return describeGame(ctx, entry);
}

/** Xóa khỏi thư viện (không xóa thư mục game, bản dịch, memory). */
export function removeGame(ctx: AppContext, id: string): void {
  const lib = load(ctx);
  lib.games = lib.games.filter(g => g.id !== id);
  save(ctx, lib);
}

/** Cập nhật 1 game (lần mở gần nhất, định dạng đang dùng). */
export function updateGame(ctx: AppContext, id: string, patch: Partial<Pick<LibraryEntry, "openedAt" | "format">>): LibraryEntry {
  const lib = load(ctx);
  const g = lib.games.find(x => x.id === id);
  if (!g) throw new Error("Game này không còn trong thư viện.");
  Object.assign(g, patch);
  save(ctx, lib);
  return g;
}
