/**
 * Đọc / ghi CSV theo đúng cách game đọc (hàm CSV trong plugin MEO_Csv.js).
 *
 * Mục tiêu: khi ghi lại, CHỈ thay đúng các ô đã dịch; mọi thứ khác (dấu ngoặc, xuống dòng CRLF,
 * ô trống, dòng chú thích...) giữ nguyên từng byte → game và các plugin khác đọc file y như cũ.
 *
 * Quy tắc của MEO_Csv (đã bỏ hết ký tự \r trước khi đọc):
 *  - ô bắt đầu bằng " → ô có ngoặc; trong ngoặc được chứa dấu phẩy và xuống dòng
 *  - "" → 1 dấu "
 *  - ngoặc đóng khi gặp " đứng ngay trước dấu phẩy hoặc xuống dòng
 *  - dòng cuối file phải có xuống dòng (nếu không, game bỏ mất dòng cuối)
 */

export interface CsvCell {
  /** Giá trị ô (đã bỏ \r, giống hệt giá trị game đọc được). */
  value: string;
  /** Vị trí trong văn bản gốc: [start, end) – gồm cả dấu ngoặc nếu có. */
  start: number;
  end: number;
  quoted: boolean;
}

export interface CsvDoc {
  text: string;
  rows: CsvCell[][];
  /** Kiểu xuống dòng của file ("\r\n" hoặc "\n"). */
  eol: string;
}

export function parseCsv(text: string): CsvDoc {
  const rows: CsvCell[][] = [[]];
  let field = "";
  let inQuote = false;
  let quoted = false;
  let start = 0;

  /** Ký tự kế tiếp, bỏ qua \r (vì game xóa \r trước khi đọc). */
  const nextAt = (i: number) => {
    let j = i + 1;
    while (text[j] === "\r") j++;
    return { ch: text[j] as string | undefined, idx: j };
  };
  const push = (end: number) => {
    rows[rows.length - 1].push({ value: field, start, end, quoted });
    field = "";
    quoted = false;
  };

  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === undefined) { rows.pop(); break; } // giống game: bỏ dòng cuối chưa kết thúc
    if (c === "\r") continue;
    const nx = nextAt(i);

    if (inQuote && c === '"' && (nx.ch === "," || nx.ch === "\n")) {
      inQuote = false;
    } else if (!inQuote && field === "" && c === '"') {
      inQuote = true;
      quoted = true;
    } else if (!inQuote && (c === "," || c === "\n" || (c === '"' && nx.ch === ","))) {
      // Ô kết thúc tại vị trí này (trước \r nếu là \r\n)
      let end = i;
      if (c === "\n") while (end > start && text[end - 1] === "\r") end--;
      push(end);
      start = i + 1;
      if (c === "\n") rows.push([]);
    } else {
      if (c === '"' && nx.ch === '"') i = nx.idx;
      field += c;
    }
  }
  const eol = /\r\n/.test(text.slice(0, 20000)) ? "\r\n" : "\n";
  return { text, rows, eol };
}

/** Viết 1 giá trị thành ô CSV (thêm ngoặc khi cần). */
export function quoteCell(value: string, eol: string, forceQuote = false): string {
  const needs = forceQuote || /[",\n\r]/.test(value);
  if (!needs) return value;
  return '"' + value.replace(/\r/g, "").replace(/"/g, '""').replace(/\n/g, eol) + '"';
}

/**
 * Thay giá trị một số ô, trả về toàn bộ văn bản mới.
 * Ô không đổi giá trị → giữ nguyên byte gốc.
 */
export function replaceCells(doc: CsvDoc, changes: Map<string, string>): string {
  const edits: { start: number; end: number; raw: string }[] = [];
  for (const [key, value] of changes) {
    const [r, c] = key.split(",").map(Number);
    const cell = doc.rows[r]?.[c];
    if (!cell) throw new Error(`Ô CSV không tồn tại: dòng ${r + 1}, cột ${c + 1}`);
    if (cell.value === value) continue;
    edits.push({ start: cell.start, end: cell.end, raw: quoteCell(value, doc.eol, cell.quoted) });
  }
  // Ghép 1 lần theo thứ tự (file lớn như sheet.csv có hàng chục nghìn ô cần thay)
  edits.sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let pos = 0;
  for (const e of edits) {
    parts.push(doc.text.slice(pos, e.start), e.raw);
    pos = e.end;
  }
  parts.push(doc.text.slice(pos));
  return parts.join("");
}

/** Tên cột kiểu bảng tính → chỉ số (A=0, B=1, ..., AA=26). */
export function columnIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
