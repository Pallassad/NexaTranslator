import type { TranslationProvider } from "./types";
import { fetchWithRetry, sleep } from "./errors";

/** DeepL dùng mã ngôn ngữ viết hoa, tiếng Trung là "ZH". */
function lang(l: string): string {
  if (l.toLowerCase().startsWith("zh")) return "ZH";
  return l.toUpperCase();
}

export interface DeepLOptions { key: string; delayMs?: number; }

/**
 * DeepL API. Key gói Free kết thúc bằng ":fx" và dùng địa chỉ api-free.deepl.com.
 * Gói Free: 500.000 ký tự/tháng. Tối đa 50 câu mỗi request.
 */
export class DeepLProvider implements TranslationProvider {
  name = "DeepL";
  private base: string;

  constructor(private opt: DeepLOptions) {
    this.base = opt.key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  }

  async translateBatch(texts: string[], from: string, to: string): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < texts.length; i += 50) {
      out.push(...(await this.request(texts.slice(i, i + 50), from, to)));
      if (i + 50 < texts.length) await sleep(this.opt.delayMs ?? 200);
    }
    return out;
  }

  private async request(texts: string[], from: string, to: string): Promise<string[]> {
    const body: Record<string, unknown> = { text: texts, target_lang: lang(to), preserve_formatting: true };
    if (from !== "auto") body.source_lang = lang(from);

    const res = await fetchWithRetry(this.name, `${this.base}/v2/translate`, {
      method: "POST",
      headers: { Authorization: `DeepL-Auth-Key ${this.opt.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, {
      // 456 = hết quota, 403 = sai key
      classify: s => (s === 456 ? "quota" : s === 401 || s === 403 ? "auth" : null),
    });
    const data = (await res.json()) as { translations: { text: string }[] };
    return data.translations.map(t => t.text);
  }
}
