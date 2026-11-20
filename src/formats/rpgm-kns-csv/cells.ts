import type { Entry, Kind } from "../../core/types";
import type { CellMode } from "./rules";

/**
 * Tách 1 ô CSV thành các mảnh chữ cần dịch, và ghép bản dịch trở lại.
 *
 * Ô thoại (mode "message"), ví dụ:
 *   \c[6][Thug A]\c[0]/            ← nhãn người nói: tên chữ → giữ nguyên (chỉ đổi theo glossary)
 *   Heeeh.../                      ← các dòng thoại: gộp lại thành 1 câu để dịch,
 *   Don't get cocky kiddo\, I'm…   ←   rồi chia lại số dòng như cũ
 * Dấu "/" cuối dòng = quy ước xuống dòng của plugin → giữ nguyên.
 * "\," (dấu phẩy viết kiểu mã) → gửi đi dịch như dấu phẩy thường.
 */

export interface Piece {
  /** Chỉ số dòng trong ô. */
  line: number;
  pre: string;
  post: string;
  /** Chữ gốc đúng như trong file. */
  raw: string;
  entry: Entry;
}

export interface CellPieces {
  /** Các dòng của ô gốc. */
  lines: string[];
  pieces: Piece[];
}

/** Có chữ thật (không chỉ toàn mã, dấu câu, khoảng trắng). */
const hasLetters = (s: string) => /\p{L}/u.test(s.replace(/\\[A-Za-z]+\[[^\]]*\]|\\[A-Za-z]/g, ""));
/** "\," → "," (game hiện "\," thành dấu phẩy). */
const normalize = (s: string) => s.replace(/\\,/g, ",");

/** Nhãn người nói: \c[6][Tên]\c[0] hoặc \c[6]【Tên】\c[0] (có thể kèm dấu cách). */
const SPEAKER = /^((?:\\c\[\d+\])?\s*[[【])([^\]】]*)([\]】]\s*(?:\\c\[\d+\])?\s*)$/i;

export function splitCell(
  value: string, mode: CellMode, kind: Kind, file: string, r: number, c: number,
): CellPieces {
  const lines = value.split("\n");
  const pieces: Piece[] = [];
  const add = (line: number, pre: string, raw: string, post: string, k: Kind, block?: string) => {
    if (!raw.trim() || !hasLetters(raw)) return;
    const path = mode === "plain" ? [r, c] : [r, c, line];
    pieces.push({ line, pre, post, raw, entry: { file, path, kind: k, source: normalize(raw), ...(block ? { block } : {}) } });
  };

  if (mode === "plain") {
    add(0, "", value, "", kind);
    return { lines: [value], pieces };
  }

  lines.forEach((line, i) => {
    if (mode === "progress") {
      const m = line.match(/^(\s*\$progress\d+\s*=)(.*)$/);
      if (m) add(i, m[1], m[2], "", kind);
      return;
    }
    // message
    const post = line.endsWith("/") ? "/" : "";
    const body = post ? line.slice(0, -1) : line;
    if (i === 0) {
      const s = body.match(SPEAKER);
      if (s) {
        add(i, s[1], s[2], s[3] + post, "speaker"); // mã tên \n[2] / \v[5] → không có chữ → bỏ qua
        return;
      }
    }
    add(i, "", body, post, kind, `${r}:${c}`);
  });
  return { lines, pieces };
}

/**
 * Ghép bản dịch vào ô. `useRaw`: mảnh chưa dịch thì dùng chữ gốc trong file.
 * Ô thoại: dòng thừa (bản dịch ngắn hơn) bị bỏ; dòng cuối giữ đúng kiểu kết thúc như gốc (có/không có "/").
 */
export function joinCell(cell: CellPieces, mode: CellMode, targets: Map<Piece, string | undefined>): string {
  if (mode === "plain") {
    const p = cell.pieces[0];
    return p ? (targets.get(p) ?? p.raw) : cell.lines[0];
  }
  const out: (string | null)[] = [...cell.lines];
  for (const p of cell.pieces) {
    const t = targets.get(p);
    if (t === undefined) continue;
    if (t === "" && mode === "message") { out[p.line] = null; continue; } // dòng thừa
    // Bản dịch dài hơn → có "\n" bên trong: giữ quy ước "/" trước mỗi lần xuống dòng
    const text = p.post === "/" ? t.replace(/\n/g, "/\n") : t;
    out[p.line] = p.pre + text + p.post;
  }
  const kept = out.filter((l): l is string => l !== null);
  if (mode === "message" && kept.length < out.length) {
    // Dòng cuối mới phải kết thúc giống dòng cuối gốc (nếu không, "/" ở cuối sẽ hiện ra màn hình)
    const lastOrig = cell.lines[cell.lines.length - 1];
    const i = kept.length - 1;
    if (i >= 0 && !lastOrig.endsWith("/") && kept[i].endsWith("/")) kept[i] = kept[i].slice(0, -1);
  }
  return kept.join("\n");
}
