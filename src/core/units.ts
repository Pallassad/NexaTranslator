import type { Entry } from "./types";
import { splitAffix, protect, restore, visibleLength, type Affix } from "./protect";
import { cleanTranslation, wrapText } from "./postprocess";
import type { GlossaryMatcher } from "./glossary";

/** Một đoạn chữ đã bảo vệ, sẵn sàng gửi đi dịch. */
export interface Segment { text: string; tokens: string[]; }

/**
 * Một "đơn vị dịch": gồm 1 hoặc nhiều Entry và các Segment cần dịch.
 * Sau khi dịch, gọi assemble() để điền target cho từng Entry.
 */
export interface Unit {
  entries: Entry[];
  segments: Segment[];
  /** Trả về lý do lỗi nếu bản dịch không hợp lệ (khi đó giữ nguyên text gốc). */
  assemble(translated: string[]): string | null;
}

export interface UnitOptions {
  maxChars: number;
  /** Glossary: giữ nguyên tên / dịch cố định thuật ngữ. */
  glossary?: GlossaryMatcher;
}

const NBSP = "\u00A0";
const NBSP_RE = /\u00A0/g;

/** Đổi tên trong mã khung tên (\n<...>) theo glossary. */
const names = (s: string, opt: UnitOptions) => (opt.glossary ? opt.glossary.applyNameCodes(s) : s);

/** Đường dẫn tới danh sách lệnh chứa entry thoại, và chỉ số lệnh. */
function listKey(e: Entry): { key: string; index: number } {
  const p = e.path;
  // Định dạng khác (CSV...): khối + số thứ tự dòng ở cuối path
  if (e.block !== undefined) return { key: e.file + "|" + e.block, index: Number(p[p.length - 1]) };
  // RPGM: path dạng [..., "list", ci, "parameters", 0]
  return { key: e.file + "|" + p.slice(0, -3).join("."), index: Number(p[p.length - 3]) };
}

/** Ghép các phần chữ: thêm dấu cách nếu là chữ Latin, không thêm nếu là chữ Nhật/Trung. */
function joinParts(parts: string[]): string {
  return parts.reduce((acc, part) => {
    if (!acc) return part;
    if (!part) return acc;
    const needSpace = /[\x21-\x7EÀ-ɏ]$/.test(acc) && /^[\x21-\x7EÀ-ɏ]/.test(part);
    return acc + (needSpace ? " " : "") + part;
  }, "");
}

function allSame(xs: string[]): boolean {
  return xs.every(x => x === xs[0]);
}

/** Đơn vị cho 1 khối thoại (nhiều dòng 401 liên tiếp = 1 khung thoại). */
function dialogueUnit(entries: Entry[], opt: UnitOptions): Unit {
  const parts: Affix[] = entries.map(e => splitAffix(e.source));
  const prefixes = parts.map(p => p.prefix);
  const suffixes = parts.map(p => p.suffix);
  const samePrefix = allSame(prefixes);
  const sameSuffix = allSame(suffixes);
  // Mã đầu/cuối của các dòng ở GIỮA khối (vd icon \I[122] cuối dòng 1) phải đi theo câu,
  // không được bỏ: đưa vào trong câu (được bảo vệ thành {n} khi dịch).
  // Chỉ mã đầu dòng đầu / cuối dòng cuối (hoặc mã giống nhau ở mọi dòng) được đặt lại ở ngoài.
  const n = parts.length;
  const core = joinParts(parts.map((p, i) => {
    const pre = !samePrefix && i > 0 ? p.prefix.trim() : "";
    const suf = !sameSuffix && i < n - 1 ? p.suffix.trim() : "";
    return (pre + p.core.trim() + suf).trim();
  }));
  const seg = protect(core, opt.glossary);

  return {
    entries,
    segments: core ? [seg] : [],
    assemble([translated]) {
      if (!core) {
        // Dòng chỉ có mã (vd chỉ có khung tên \n<Rin>) → giữ nguyên, chỉ đổi tên theo glossary
        for (const e of entries) e.target = names(e.source, opt);
        return null;
      }
      // Dấu cách trong thuật ngữ / mã → tạm đổi thành dấu cách không ngắt để không bị xuống dòng giữa chừng
      // (vd "Chiến binh", "Rừng Hắc Ám" luôn nằm trọn trên 1 dòng)
      const r = restore(cleanTranslation(translated), seg.tokens.map(t => t.replace(/ /g, NBSP)));
      if (!r.ok) return r.reason;

      const lines = wrapText(r.text, opt.maxChars).map(l => l.replace(NBSP_RE, " "));
      const deco = lines.map((line, i) => {
        const pre = samePrefix ? prefixes[0] : i === 0 ? prefixes[0] : "";
        const suf = sameSuffix ? suffixes[0] : i === lines.length - 1 ? suffixes[suffixes.length - 1] : "";
        return pre + line + suf;
      });

      // Phân bổ dòng vào các lệnh 401 có sẵn:
      // - ít dòng hơn: các lệnh thừa để trống (giữ nguyên số dòng → không tràn khung)
      // - nhiều dòng hơn: dồn phần dư vào lệnh cuối bằng "\n" (game tự xuống dòng/sang trang)
      entries.forEach((e, i) => {
        if (i < n - 1) e.target = names(deco[i] ?? "", opt);
        else e.target = names(deco.slice(n - 1).join("\n"), opt);
      });
      return null;
    },
  };
}

/** Đơn vị cho 1 entry đơn (tên, mô tả, lựa chọn, thuật ngữ...). Giữ nguyên số dòng nếu có "\n". */
function singleUnit(entry: Entry, opt: UnitOptions): Unit {
  const lines = entry.source.split("\n").map(splitAffix);
  const segs = lines.map(l => protect(l.core, opt.glossary));
  const idx = segs.map((s, i) => (s.text.trim() ? i : -1)).filter(i => i >= 0);

  return {
    entries: [entry],
    segments: idx.map(i => segs[i]),
    assemble(translated) {
      const out = lines.map(l => l.prefix + l.core + l.suffix);
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        const r = restore(cleanTranslation(translated[k]), segs[i].tokens);
        if (!r.ok) return r.reason;
        out[i] = lines[i].prefix + r.text + lines[i].suffix;
      }
      entry.target = names(out.join("\n"), opt);
      return null;
    },
  };
}

/** Tên người nói (lệnh 101): không dịch, chỉ đổi khi glossary có thuật ngữ cho đúng tên đó. */
function speakerUnit(entry: Entry, opt: UnitOptions): Unit {
  return {
    entries: [entry],
    segments: [],
    assemble() {
      entry.target = opt.glossary?.exact(entry.source) ?? entry.source;
      return null;
    },
  };
}

/** Độ rộng dòng thoại lớn nhất của game (dùng làm giới hạn khi ngắt dòng). */
export function measureMaxChars(entries: Entry[]): number {
  const lens = entries.filter(e => e.kind === "dialogue").map(e => visibleLength(e.source.trim()));
  if (lens.length === 0) return 50;
  lens.sort((a, b) => a - b);
  // Lấy phân vị 98% để bỏ qua vài dòng dài bất thường
  return Math.max(30, Math.min(80, lens[Math.floor(lens.length * 0.98)]));
}

/** Gom danh sách Entry thành các đơn vị dịch. */
export function buildUnits(entries: Entry[], opt: UnitOptions): Unit[] {
  const units: Unit[] = [];
  let block: Entry[] = [];
  let last: { key: string; index: number } | null = null;

  const flush = () => {
    if (block.length) units.push(dialogueUnit(block, opt));
    block = [];
    last = null;
  };

  for (const e of entries) {
    if (e.kind !== "dialogue") {
      flush();
      units.push(e.kind === "speaker" ? speakerUnit(e, opt) : singleUnit(e, opt));
      continue;
    }
    const k = listKey(e);
    if (!last || last.key !== k.key || k.index !== last.index + 1) flush();
    block.push(e);
    last = k;
  }
  flush();
  return units;
}
