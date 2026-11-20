/**
 * Bảo vệ mã điều khiển trước khi gửi đi dịch.
 *
 *  Gốc:     "<center>\C[2]Alice\C[0] got %1!"
 *  Tách:    prefix "<center>\C[2]"  core "Alice\C[0] got %1!"  suffix ""
 *  Bảo vệ:  "Alice{0} got {1}!"   tokens ["\C[0]", "%1"]
 */

/** Các dạng mã điều khiển thường gặp trong RPG Maker MV/MZ và plugin. */
const CODE_SRC = [
  // @ec(...) – đoạn script trong chữ (plugin KNS), cho phép lồng ngoặc 3 tầng
  String.raw`@ec\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)`,
  String.raw`\\\\+[A-Za-z][A-Za-z0-9_]*\[[^\]\n]*\]`,  // \\C[27] – mã viết 2 dấu gạch (chữ đi qua script trước khi hiện)
  String.raw`\\[A-Za-z][A-Za-z0-9_]*\[[^\]\n]*\]`,   // \C[2] \N[1] \FS[24] \REM_DESC[skill_51_name]
  String.raw`\\[A-Za-z]+<[^>\n]*>`,      // \Picture<abc> (VisuStella)
  String.raw`\\[A-Za-z]+\{[^}\n]*\}`,    // \tl{A0001} – tra bảng Languages.tsv (VisuStella)
  String.raw`\\f[bir](?![A-Za-z\[])`,   // \fb \fi \fr – chữ đậm / nghiêng / bỏ định dạng (YEP MessageCore)
  String.raw`\\[A-Za-z](?![A-Za-z\[])`,  // \G \I (mã 1 chữ cái không có [...])
  String.raw`\\[^A-Za-z\s]`,             // \! \. \| \{ \} \^ \$ \\
  String.raw`<\/?[A-Za-z][^<>\n]{0,30}>`, // <center> <WordWrap> </b>
  String.raw`%\d+`,                      // %1 %2 (thông báo hệ thống)
].join("|");

export const CODE = new RegExp(CODE_SRC, "g");
/**
 * Mã được tách ra đầu/cuối dòng: chỉ mã TRANG TRÍ (màu, cỡ chữ, icon, chờ, căn lề...).
 * Mã mang NỘI DUNG – \N[1] tên nhân vật, \V[2] giá trị biến, \P[1] thành viên, @ec(...) –
 * là một phần của câu ("\N[1] noticed..." = "Leon noticed...") → giữ lại trong câu để dịch đúng ngữ pháp.
 */
const DECO_SRC = String.raw`(?!\\+[NnVvPp]\[|@ec\()(?:${CODE_SRC})`;
const PREFIX = new RegExp(`^(?:[\\s\\u3000]|${DECO_SRC})+`);
const SUFFIX = new RegExp(`(?:[\\s\\u3000]|${DECO_SRC})+$`);

export interface Affix { prefix: string; core: string; suffix: string; }

/** Tách phần đầu/cuối dòng (dấu cách, mã căn lề, mã màu...) khỏi phần chữ. */
export function splitAffix(text: string): Affix {
  const prefix = text.match(PREFIX)?.[0] ?? "";
  const rest = text.slice(prefix.length);
  const suffix = rest.match(SUFFIX)?.[0] ?? "";
  return { prefix, core: rest.slice(0, rest.length - suffix.length), suffix };
}

export interface Protected { text: string; tokens: string[]; }

/** Đối tượng thay thuật ngữ glossary (xem glossary.ts). */
export interface TermReplacer {
  replace(text: string, makeToken: (value: string) => string): string;
}

/**
 * Thay mã điều khiển ở giữa câu bằng {0}, {1}...; nếu có glossary thì thay luôn thuật ngữ.
 * Token của thuật ngữ = bản dịch cố định (hoặc chữ gốc nếu là "giữ nguyên").
 */
export function protect(core: string, glossary?: TermReplacer): Protected {
  const tokens: string[] = [];
  const add = (v: string) => `{${tokens.push(v) - 1}}`;
  let text = core.replace(CODE, add);
  if (glossary) text = glossary.replace(text, add);
  return { text, tokens };
}

/**
 * Khôi phục placeholder. Chấp nhận cả kiểu Google làm méo như "{ 0 }".
 * Trả lỗi nếu thiếu, thừa hoặc lặp placeholder.
 */
export function restore(translated: string, tokens: string[]): { ok: true; text: string } | { ok: false; reason: string } {
  const used = new Array(tokens.length).fill(0);
  let bad = false;
  const text = translated.replace(/\{\s*(\d+)\s*\}/g, (m, n) => {
    const i = Number(n);
    if (i >= tokens.length) { bad = true; return m; }
    used[i]++;
    return tokens[i];
  });
  if (bad) return { ok: false, reason: "Bản dịch có placeholder lạ" };
  const missing = used.findIndex(c => c !== 1);
  if (missing >= 0) {
    return { ok: false, reason: `Placeholder {${missing}} (${tokens[missing]}) bị ${used[missing] === 0 ? "mất" : "lặp"}` };
  }
  return { ok: true, text };
}

/** Độ dài hiển thị gần đúng (bỏ mã điều khiển). */
export function visibleLength(s: string): number {
  return s.replace(CODE, "").length;
}
