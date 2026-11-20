import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assetsDir } from "./assets";

/**
 * Chuyển tên nhân vật sang chữ Latin để người Việt đọc được:
 *  - Tên Latin (tiếng Anh...)  → giữ nguyên.
 *  - Game tiếng Nhật: kana → Romaji (offline, kiểu "Sato": bỏ trường âm ō/ū);
 *    có kanji → cần cách đọc từ Google (xem googleReading trong providers/google.ts).
 *  - Game tiếng Trung: chữ Hán → âm Hán Việt (offline, assets/hanviet.json): 李白 → Lý Bạch.
 * Không DỊCH NGHĨA tên (ひかり → "ánh sáng" là sai).
 */

export type NameLang = "ja" | "zh" | "latin";

const KANA = /[ぁ-ゖァ-ヺー]/;
const CJK = /[㐀-䶿一-鿿豈-﫿]/;
/** Dấu ngăn cách trong tên: ・ (Nhật), · (Trung), khoảng trắng thường / toàn khổ. */
const SEP = /[\s　・·•＝=]+/;

export const hasKana = (s: string) => KANA.test(s);
export const hasHan = (s: string) => CJK.test(s);
/** Tên chỉ gồm chữ Latin / số / dấu → giữ nguyên. */
export const isLatinName = (s: string) => !hasKana(s) && !hasHan(s);

/**
 * Nhận diện ngôn ngữ của CẢ GAME (không theo từng tên: 佐藤 hợp lệ cả tiếng Nhật lẫn Trung).
 * Có kana đáng kể → Nhật; chỉ có chữ Hán → Trung; còn lại → Latin.
 */
export function detectNameLang(texts: Iterable<string>): NameLang {
  let kana = 0, han = 0;
  for (const t of texts) {
    for (const ch of t) {
      if (KANA.test(ch)) kana++;
      else if (CJK.test(ch)) han++;
    }
    if (kana >= 200) return "ja";
  }
  if (kana >= 20 || (kana > 0 && kana >= han * 0.05)) return "ja";
  if (han >= 20) return "zh";
  return "latin";
}

// ---------------------------------------------------------------------------
// Kana → Romaji (Hepburn, kiểu "Sato")
// ---------------------------------------------------------------------------

const BASE: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko", が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so", ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to", だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho", ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "i", ゑ: "e", を: "o", ん: "n", ゔ: "vu",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa", ゕ: "ka", ゖ: "ke",
};

/** Âm ghép 2 ký tự (きゃ, しょ...) và âm mượn trong katakana (ティ, ファ, ヴィ...). */
const PAIRS: Record<string, string> = {};
for (const [k, r] of Object.entries({ き: "k", ぎ: "g", に: "n", ひ: "h", び: "b", ぴ: "p", み: "m", り: "r" })) {
  PAIRS[k + "ゃ"] = r + "ya"; PAIRS[k + "ゅ"] = r + "yu"; PAIRS[k + "ょ"] = r + "yo";
}
for (const [k, r] of Object.entries({ し: "sh", じ: "j", ぢ: "j", ち: "ch" })) {
  PAIRS[k + "ゃ"] = r + "a"; PAIRS[k + "ゅ"] = r + "u"; PAIRS[k + "ょ"] = r + "o"; PAIRS[k + "ぇ"] = r + "e";
}
Object.assign(PAIRS, {
  てぃ: "ti", でぃ: "di", とぅ: "tu", どぅ: "du", てゅ: "tyu", でゅ: "dyu",
  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo", ふゅ: "fyu",
  うぃ: "wi", うぇ: "we", うぉ: "wo", いぇ: "ye",
  つぁ: "tsa", つぃ: "tsi", つぇ: "tse", つぉ: "tso",
  ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo", ゔゅ: "vyu",
  くぁ: "kwa", ぐぁ: "gwa", すぃ: "si", ずぃ: "zi",
});

/** Katakana → hiragana (ァ..ヶ lệch 0x60). */
const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

const capitalize = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/** 1 từ kana → romaji (chữ thường). Ký tự lạ giữ nguyên. */
function kanaWord(word: string): string {
  const s = toHira(word);
  let out = "";
  let geminate = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "っ") { geminate = true; continue; }
    if (ch === "ー") continue; // trường âm katakana: bỏ (kiểu Sato)
    let syl = PAIRS[s.slice(i, i + 2)];
    if (syl) i++;
    else syl = BASE[ch] ?? ch;

    // Trường âm: o+う / o+お → o, u+う → u (さとう → sato, ゆうき → yuki, おおの → ono)
    const next = s[i + 1];
    if ((syl.endsWith("o") && (next === "う" || next === "お")) || (syl.endsWith("u") && next === "う" && syl !== "u")) i++;

    if (geminate) {
      // っ: lặp phụ âm đầu của âm sau (っち → tchi theo Hepburn)
      syl = syl.startsWith("ch") ? "t" + syl : /^[a-z]/.test(syl) && !/^[aiueon]/.test(syl) ? syl[0] + syl : syl;
      geminate = false;
    }
    out += syl;
  }
  return out;
}

/** Tên kana → Romaji, viết hoa đầu mỗi từ: さとう → Sato, アリス・マーガトロイド → Arisu Magatoroido. */
export function kanaToRomaji(name: string): string {
  return name.split(SEP).filter(Boolean).map(w => capitalize(kanaWord(w))).join(" ");
}

/** Tên chỉ gồm kana (và dấu ngăn cách) → chuyển offline được, không cần Google. */
export const isKanaOnly = (s: string) => /^[ぁ-ゖァ-ヺー\s　・·•＝=]+$/.test(s.trim()) && hasKana(s);

/** Làm sạch cách đọc Google trả về: "Satō Hanako" → "Sato Hanako" (bỏ dấu trường âm, viết hoa đầu từ). */
export function cleanReading(r: string): string {
  return r
    .normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC")
    .replace(/[^A-Za-z0-9'\- ]+/g, " ")
    .split(/\s+/).filter(Boolean)
    .map(w => capitalize(w.toLowerCase()))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Chữ Hán → Hán Việt
// ---------------------------------------------------------------------------

let HANVIET: Record<string, string> | null = null;
function hanvietDict(): Record<string, string> {
  if (!HANVIET) {
    try { HANVIET = JSON.parse(readFileSync(join(assetsDir(), "hanviet.json"), "utf8")); }
    catch { HANVIET = {}; }
  }
  return HANVIET!;
}

/** 李白 → { text: "Lý Bạch", missing: [] }. Chữ không có trong từ điển giữ nguyên và báo trong missing. */
export function toHanViet(name: string): { text: string; missing: string[] } {
  const dict = hanvietDict();
  const missing: string[] = [];
  const words = name.split(SEP).filter(Boolean).map(w => {
    const out: string[] = [];
    let latin = "";
    for (const ch of w) {
      const r = dict[ch];
      if (r) {
        if (latin) { out.push(latin); latin = ""; }
        out.push(capitalize(r));
      } else if (hasHan(ch) || hasKana(ch)) {
        if (latin) { out.push(latin); latin = ""; }
        missing.push(ch);
        out.push(ch);
      } else latin += ch;
    }
    if (latin) out.push(latin);
    return out.join(" ");
  });
  return { text: words.join(" "), missing };
}

// ---------------------------------------------------------------------------
// Gợi ý cho cả danh sách tên
// ---------------------------------------------------------------------------

export type NameMethod = "latin" | "kana" | "google" | "hanviet" | "none";

export interface NameSuggestion {
  source: string;
  suggestion: string;
  method: NameMethod;
  /** Ghi chú cho người dùng (vd chữ không có trong từ điển, Google không trả cách đọc). */
  note?: string;
}

/** Hàm lấy cách đọc tên tiếng Nhật có kanji (Google). Trả undefined khi không có. */
export type ReadingFn = (name: string) => Promise<string | undefined>;

export async function suggestNames(names: string[], lang: NameLang, reading?: ReadingFn): Promise<NameSuggestion[]> {
  const out: NameSuggestion[] = [];
  for (const source of names) {
    const s = source.trim();
    if (isLatinName(s)) { out.push({ source, suggestion: s, method: "latin" }); continue; }
    if (lang === "zh" || (lang === "latin" && !hasKana(s))) {
      const r = toHanViet(s);
      out.push({ source, suggestion: r.text, method: "hanviet",
        ...(r.missing.length ? { note: `Không có âm Hán Việt cho: ${r.missing.join(" ")}` } : {}) });
      continue;
    }
    if (isKanaOnly(s)) { out.push({ source, suggestion: kanaToRomaji(s), method: "kana" }); continue; }
    let r: string | undefined;
    let err = "";
    try { r = reading ? await reading(s) : undefined; } catch (e) { err = e instanceof Error ? e.message : String(e); }
    const clean = r ? cleanReading(r) : "";
    if (clean && isLatinName(clean)) out.push({ source, suggestion: clean, method: "google" });
    else out.push({ source, suggestion: "", method: "none",
      note: err ? `Không lấy được cách đọc từ Google (${err}) – hãy tự nhập` : "Google không trả cách đọc – hãy tự nhập" });
  }
  return out;
}
