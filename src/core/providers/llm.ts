import type { Pricing, TranslationProvider, Usage } from "./types";
import { sleep } from "./errors";

const LANG_NAME: Record<string, string> = {
  vi: "Vietnamese", en: "English", ja: "Japanese", "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese", zh: "Chinese", ko: "Korean",
};
const langName = (l: string) => LANG_NAME[l] ?? l;

/** Lấy mảng JSON từ câu trả lời của AI (bỏ ```json, chữ thừa trước/sau). */
export function parseJsonArray(text: string): string[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(arr) ? arr.map(x => String(x ?? "")) : null;
  } catch {
    return null;
  }
}

export interface LLMOptions {
  model: string;
  /** Số câu mỗi request (mặc định 30). */
  batchSize?: number;
  delayMs?: number;
  /** Hướng dẫn thêm: văn phong, xưng hô... */
  extraPrompt?: string;
  pricing?: Pricing;
  paid?: boolean;
}

/** Kết quả 1 lần gọi AI. */
export interface Completion { text: string; refused: boolean; }

/**
 * Phần dùng chung cho mọi engine AI: dựng prompt, chia lô, đọc mảng JSON,
 * chia đôi khi AI trả sai định dạng, và đánh dấu null cho câu AI từ chối dịch.
 */
export abstract class LLMProvider implements TranslationProvider {
  abstract name: string;
  paid: boolean;
  pricing?: Pricing;
  usage: Usage = { input: 0, output: 0 };

  constructor(protected opt: LLMOptions) {
    this.paid = opt.paid ?? true;
    this.pricing = opt.pricing;
  }

  /** Gọi API thật – lớp con cài đặt; nhớ cộng this.usage. */
  protected abstract complete(system: string, user: string): Promise<Completion>;

  protected systemPrompt(from: string, to: string) {
    return [
      `You are a professional game localizer translating dialogue and UI text of an RPG Maker game` +
        (from === "auto" ? "" : ` from ${langName(from)}`) + ` into ${langName(to)}.`,
      "Rules:",
      "- Input is a JSON array of strings. Output ONLY a JSON array of strings with exactly the same length and order.",
      "- Keep placeholders like {0}, {1} exactly as they are, in a natural position.",
      "- Do not merge, split, skip or explain items. Do not add notes.",
      "- Keep character names unchanged unless they are common words.",
      "- Use natural, fluent wording that fits the tone of each line (casual dialogue, menus, item descriptions).",
      this.opt.extraPrompt ?? "",
    ].join("\n");
  }

  private async request(texts: string[], from: string, to: string): Promise<string[] | null> {
    const r = await this.complete(this.systemPrompt(from, to), JSON.stringify(texts));
    if (r.refused) return null;
    const arr = parseJsonArray(r.text);
    if (!arr || arr.length !== texts.length) return null;
    // Câu trong tool không chứa xuống dòng → bỏ xuống dòng AI tự thêm
    return arr.map(s => s.replace(/\s*\n\s*/g, " "));
  }

  /** Dịch 1 nhóm; AI trả sai/từ chối → chia đôi; còn 1 câu vẫn lỗi → null (để engine khác dịch). */
  private async translateGroup(texts: string[], from: string, to: string): Promise<(string | null)[]> {
    const r = await this.request(texts, from, to);
    if (r) return r;
    if (texts.length === 1) return [null];
    const mid = Math.ceil(texts.length / 2);
    return [
      ...(await this.translateGroup(texts.slice(0, mid), from, to)),
      ...(await this.translateGroup(texts.slice(mid), from, to)),
    ];
  }

  async translateBatch(texts: string[], from: string, to: string): Promise<(string | null)[]> {
    const size = this.opt.batchSize ?? 30;
    const out: (string | null)[] = [];
    for (let i = 0; i < texts.length; i += size) {
      out.push(...(await this.translateGroup(texts.slice(i, i + size), from, to)));
      if (i + size < texts.length) await sleep(this.opt.delayMs ?? 300);
    }
    return out;
  }
}
