import { existsSync } from "node:fs";
import { readJson, writeJson } from "./writer";
import type { Entry } from "./types";

/**
 * Glossary:
 *  - keep  : chuỗi GIỮ NGUYÊN, không dịch (tên nhân vật...)
 *  - terms : chuỗi luôn dịch CỐ ĐỊNH theo bảng (tên khu vực, thuật ngữ, tên chung "Taxi Driver"...)
 *
 * Cách áp dụng: trước khi gửi đi dịch, mỗi chỗ xuất hiện thuật ngữ được thay bằng placeholder {n};
 * dịch xong thì {n} được thay bằng bản dịch cố định (terms) hoặc chữ gốc (keep).
 * → Engine không thể dịch sai/lệch tên; đổi bản dịch của 1 thuật ngữ KHÔNG cần dịch lại câu.
 */
export interface Glossary {
  keep: string[];
  terms: Record<string, string>;
  /**
   * Chỉ thay khi CẢ chuỗi khớp (tên trong Actors.json, tên người nói), không thay trong câu thoại.
   * Dùng cho tên nhân vật quá ngắn (光, Ai) – thay trong thoại sẽ khớp nhầm từ thường.
   */
  exactOnly?: Record<string, string>;
}

/** Nội dung file projects/<game>/glossary.json do người dùng sửa. */
export interface GlossaryFile extends Glossary {
  /** Tên tự động giữ nguyên nhưng bạn MUỐN dịch (bỏ khỏi danh sách giữ nguyên). */
  translate: string[];
  /** Tên nhân vật (Actors.json) đã duyệt: "佐藤": "Sato". Dùng cho menu, \\N[n], tên người nói và thoại. */
  actors: Record<string, string>;
}

const HELP =
  "keep: chuỗi giữ nguyên không dịch. terms: \"chữ gốc\": \"bản dịch cố định\". " +
  "translate: tên nhân vật tool tự giữ nguyên nhưng bạn muốn dịch. " +
  "actors: tên nhân vật đã đổi (\"佐藤\": \"Sato\") – sửa trong app ở tab Glossary > Tên nhân vật. " +
  "Xem danh sách tool tự tạo bằng lệnh: npm run dev -- glossary \"<thư mục game>\"";

export function emptyGlossary(): Glossary {
  return { keep: [], terms: {} };
}

/** Đọc file glossary; chưa có thì tạo file mẫu để người dùng sửa. */
export function loadGlossaryFile(path: string, createIfMissing = true): GlossaryFile {
  if (!existsSync(path)) {
    const tpl = { _huong_dan: HELP, keep: [], terms: {}, translate: [], actors: {} };
    if (createIfMissing) writeJson(path, tpl, true);
    return { keep: [], terms: {}, translate: [], actors: {} };
  }
  const raw = readJson(path) as Partial<GlossaryFile>;
  return { keep: raw.keep ?? [], terms: raw.terms ?? {}, translate: raw.translate ?? [], actors: raw.actors ?? {} };
}

/** Ghi một phần glossary.json, giữ nguyên các mục khác (kể cả mục người dùng tự thêm vào file). */
export function updateGlossaryFile(path: string, patch: Partial<GlossaryFile>): GlossaryFile {
  const raw = existsSync(path) ? (readJson(path) as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { _huong_dan: HELP, keep: [], terms: {}, translate: [], actors: {}, ...raw };
  next._huong_dan = HELP;
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v;
  writeJson(path, next, true);
  return loadGlossaryFile(path, false);
}

/**
 * Tên nhân vật đã duyệt → glossary: tên đủ dài thay cả trong thoại (terms),
 * tên ngắn chỉ thay khi khớp nguyên chuỗi (exactOnly). Tên giữ nguyên như gốc thì bỏ qua.
 */
export function actorGlossary(actors: Record<string, string>): Glossary {
  const terms: Record<string, string> = {};
  const exactOnly: Record<string, string> = {};
  for (const [src, dst] of Object.entries(actors)) {
    const s = src.trim(), d = dst.trim();
    if (!s || !d || s === d) continue;
    exactOnly[s] = d;
    if (usableName(s)) terms[s] = d;
  }
  return { keep: [], terms, exactOnly };
}

/** Tên quá ngắn dễ khớp nhầm (vd tên 1 ký tự Hán, 1 chữ cái) → bỏ qua. */
function usableName(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return /[぀-ヿ一-鿿가-힯]/.test(t) ? t.length >= 2 : t.length >= 3;
}

/**
 * Tên nhân vật tự động giữ nguyên: CHỈ lấy từ Actors.json (nhân vật thật).
 * Không lấy tên người nói (lệnh 101) vì trong đó có nhiều tên chung như "Woman", "Child",
 * "General"... – giữ nguyên các từ này sẽ làm hỏng câu thoại có chứa chúng.
 */
export function autoKeepNames(actors: any[] | null): string[] {
  const names = new Set<string>();
  for (const a of actors ?? []) {
    const n = typeof a?.name === "string" ? a.name.trim() : "";
    if (usableName(n) && !/^(undefined|null)$/i.test(n) && !/[\\<>\[\]]/.test(n)) names.add(n);
  }
  return [...names];
}

/**
 * Bỏ các "tên" thực ra là từ thông dụng (Uncle, Bridge, Second, Guild receptionist, The Voice...).
 * Cách nhận biết (tên 1 từ): từ đó từng xuất hiện ở dạng viết thường trong chữ của game ("my uncle", "the bridge").
 * Tên tự đặt (MoyoMoyo, Siegfried) không bao giờ viết thường → vẫn được giữ nguyên.
 * Chỉ áp dụng cho chữ Latin.
 */
export function dropCommonWords(names: string[], texts: Iterable<string>): string[] {
  const lower = new Set<string>();
  for (const t of texts) for (const w of t.match(/(?<![A-Za-z])[a-z][a-z'-]*/g) ?? []) lower.add(w);
  return names.filter(n => {
    if (!isLatin(n)) return true;
    const words = n.trim().split(/\s+/);
    // Nhiều từ: bỏ nếu có từ viết thường ("Guild receptionist", "Pilgrim of Nature") hoặc bắt đầu bằng "The";
    // tên nhiều từ viết hoa ("Tiny Justice", "Lord Dogeshuna") vẫn giữ
    if (words.length > 1) return !words.some(w => /^[a-z]/.test(w)) && words[0] !== "The";
    // 1 từ: bỏ nếu từng xuất hiện viết thường ("uncle", "bridge", "second")
    return !lower.has(words[0].toLowerCase());
  });
}

/**
 * Tên khu vực đủ "đặc trưng" để đồng bộ vào thoại.
 * Tiếng Latin: ≥ 2 từ, mỗi từ viết hoa (tránh từ chung chung như "Home", "the shop").
 * Chữ Hán/Nhật/Hàn: ≥ 2 ký tự.
 */
export function isDistinctiveName(s: string): boolean {
  const t = s.trim();
  if (/[぀-ヿ一-鿿가-힯]/.test(t)) return t.length >= 2;
  const words = t.split(/\s+/);
  return words.length >= 2 && words.every(w => /^[A-Z0-9]/.test(w));
}

/** Tên khu vực nào cần đồng bộ: đủ đặc trưng VÀ có xuất hiện trong thoại. */
export function mapNamesToSync(entries: Entry[], exclude: Set<string>): Entry[] {
  const dialogue = entries.filter(e => e.kind === "dialogue" || e.kind === "choice" || e.kind === "scroll")
    .map(e => e.source).join("\n");
  const seen = new Set<string>();
  return entries.filter(e => {
    if (e.kind !== "mapName") return false;
    const s = e.source.trim();
    if (seen.has(s) || exclude.has(s) || !isDistinctiveName(s) || !dialogue.includes(s)) return false;
    seen.add(s);
    return true;
  });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isLatin = (s: string) => /^[\x20-\x7EÀ-ɏ]+$/.test(s);

/** Tìm & thay thuật ngữ trong câu. Ưu tiên chuỗi dài trước để không khớp nhầm một phần. */
export class GlossaryMatcher {
  private re: RegExp | null;
  private value = new Map<string, string>();

  constructor(public glossary: Glossary) {
    for (const k of glossary.keep) if (k.trim()) this.value.set(k, k);
    for (const [k, v] of Object.entries(glossary.terms)) if (k.trim()) this.value.set(k, v);
    const keys = [...this.value.keys()].sort((a, b) => b.length - a.length);
    // Chữ Latin: chỉ khớp nguyên từ ("Ted" không khớp trong "Tedious")
    const parts = keys.map(k => isLatin(k) ? `(?<![A-Za-z0-9])${escapeRe(k)}(?![A-Za-z0-9])` : escapeRe(k));
    this.re = parts.length ? new RegExp(parts.join("|"), "g") : null;
  }

  get size() { return this.value.size; }

  /** Thay mỗi thuật ngữ bằng kết quả của makeToken(giá trị sau khi dịch). */
  replace(text: string, makeToken: (value: string) => string): string {
    if (!this.re) return text;
    return text.replace(this.re, m => makeToken(this.value.get(m) ?? m));
  }

  /** Dịch tên trong mã khung tên của Yanfly/VisuStella: \n<Taxi Driver> → \n<Tài xế taxi>. */
  applyNameCodes(s: string): string {
    return s.replace(/\\n<([^<>\n]+)>/g, (m, name: string) =>
      this.glossary.terms[name] !== undefined ? `\\n<${this.glossary.terms[name]}>` : m);
  }

  /** Bản dịch cố định nếu cả chuỗi là một thuật ngữ (hoặc tên nhân vật đã đổi). */
  exact(s: string): string | undefined {
    return this.glossary.terms[s] ?? this.glossary.exactOnly?.[s.trim()];
  }
}

/** Gộp nhiều glossary; glossary sau ghi đè glossary trước. */
export function mergeGlossaries(...gs: Glossary[]): Glossary {
  const terms: Record<string, string> = {};
  const exactOnly: Record<string, string> = {};
  const keep = new Set<string>();
  for (const g of gs) {
    for (const k of g.keep) keep.add(k);
    for (const [k, v] of Object.entries(g.terms)) { terms[k] = v; keep.delete(k); }
    Object.assign(exactOnly, g.exactOnly);
  }
  for (const k of Object.keys(terms)) keep.delete(k);
  return Object.keys(exactOnly).length ? { keep: [...keep], terms, exactOnly } : { keep: [...keep], terms };
}
