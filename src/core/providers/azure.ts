import type { TranslationProvider } from "./types";
import { fetchWithRetry, sleep } from "./errors";

/** Mã ngôn ngữ của Azure khác Google ở tiếng Trung. */
const LANG: Record<string, string> = { "zh-CN": "zh-Hans", "zh-TW": "zh-Hant", zh: "zh-Hans" };
const lang = (l: string) => LANG[l] ?? l;

export interface AzureOptions {
  key: string;
  /** Region của resource, ví dụ "southeastasia". Bắt buộc nếu resource không phải "global". */
  region?: string;
  endpoint?: string;
  delayMs?: number;
}

/**
 * Microsoft Azure Translator (API chính thức, gói F0 miễn phí 2 triệu ký tự/tháng).
 * Giới hạn 1 request: tối đa 1000 câu và 50.000 ký tự → tool chia nhỏ hơn cho an toàn.
 */
export class AzureProvider implements TranslationProvider {
  name = "Azure";
  constructor(private opt: AzureOptions) {}

  async translateBatch(texts: string[], from: string, to: string): Promise<string[]> {
    const out: string[] = [];
    let i = 0;
    while (i < texts.length) {
      let j = i, chars = 0;
      while (j < texts.length && j - i < 100 && (j === i || chars + texts[j].length <= 10_000)) {
        chars += texts[j].length;
        j++;
      }
      out.push(...(await this.request(texts.slice(i, j), from, to)));
      i = j;
      if (i < texts.length) await sleep(this.opt.delayMs ?? 200);
    }
    return out;
  }

  private async request(texts: string[], from: string, to: string): Promise<string[]> {
    const params = new URLSearchParams({ "api-version": "3.0", to: lang(to) });
    if (from !== "auto") params.set("from", lang(from));
    const base = this.opt.endpoint ?? "https://api.cognitive.microsofttranslator.com";
    const headers: Record<string, string> = {
      "Ocp-Apim-Subscription-Key": this.opt.key,
      "Content-Type": "application/json; charset=UTF-8",
    };
    if (this.opt.region) headers["Ocp-Apim-Subscription-Region"] = this.opt.region;

    const res = await fetchWithRetry(this.name, `${base}/translate?${params}`, {
      method: "POST",
      headers,
      body: JSON.stringify(texts.map(Text => ({ Text }))),
    }, {
      // Gói F0 hết quota trả 403; sai key/region trả 401
      classify: s => (s === 401 ? "auth" : s === 403 ? "quota" : null),
    });
    const data = (await res.json()) as { translations: { text: string }[] }[];
    return data.map(d => d.translations[0].text);
  }
}
