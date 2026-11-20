import { LLMProvider, type Completion, type LLMOptions } from "./llm";
import { fetchWithRetry } from "./errors";

export { parseJsonArray } from "./llm";

export interface AIOptions extends LLMOptions {
  apiKey: string;
  /** Địa chỉ API dạng OpenAI-compatible, ví dụ https://api.openai.com/v1 */
  baseUrl: string;
  retries?: number;
}

/**
 * AI qua API dạng OpenAI-compatible (OpenAI, Gemini, DeepSeek, OpenRouter, Ollama...).
 */
export class AIProvider extends LLMProvider {
  name: string;

  constructor(private aopt: AIOptions) {
    super(aopt);
    this.name = `AI (${aopt.model})`;
  }

  protected async complete(system: string, user: string): Promise<Completion> {
    const res = await fetchWithRetry(this.name, `${this.aopt.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.aopt.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.aopt.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    }, {
      retries: this.aopt.retries ?? 5,
      classify: (status, body) => {
        if (/insufficient_quota|credit|billing/i.test(body)) return "credit";
        if (status === 401 || status === 403) return "auth";
        return null;
      },
    });
    const data = (await res.json()) as any;
    this.usage.input += data?.usage?.prompt_tokens ?? 0;
    this.usage.output += data?.usage?.completion_tokens ?? 0;
    const choice = data?.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      refused: choice?.finish_reason === "content_filter" || Boolean(choice?.message?.refusal),
    };
  }
}
