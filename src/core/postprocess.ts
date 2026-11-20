import { visibleLength } from "./protect";

const CJK_PUNCT: Record<string, string> = {
  "「": "\"", "」": "\"", "『": "\"", "』": "\"", "、": ", ", "。": ". ",
  "！": "! ", "？": "? ", "：": ": ", "；": "; ", "，": ", ", "（": "(", "）": ")",
  "～": "~", "…": "...", "　": " ",
};

/** Chuẩn hóa bản dịch: Unicode NFC, đổi dấu câu CJK, gọn khoảng trắng. */
export function cleanTranslation(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[「」『』、。！？：；，（）～…　]/g, m => CJK_PUNCT[m])
    .replace(/[ \t]+/g, " ")
    .replace(/ ([,.!?;:])/g, "$1")
    .trim();
}

/** Ngắt dòng tại dấu cách sao cho mỗi dòng không quá maxChars ký tự hiển thị. */
export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (cur && visibleLength(test) > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
