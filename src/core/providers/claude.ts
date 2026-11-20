import { LLMProvider, type Completion, type LLMOptions } from "./llm";
import { fetchWithRetry } from "./errors";

export interface ClaudeOptions extends LLMOptions {
  apiKey: string;
  retries?: number;
}

/**
 * Claude qua Anthropic Messages API (key của người dùng, tính tiền theo token).
 * - Hết credit → API trả 400 "credit balance is too low" → báo EngineUnavailable("credit").
 * - stop_reason "refusal" → coi như AI từ chối câu đó.
 */
export class ClaudeProvider extends LLMProvider {
  name: string;

  constructor(private copt: ClaudeOptions) {
    super(copt);
    this.name = `Claude (${copt.model})`;
  }

  protected async complete(system: string, user: string): Promise<Completion> {
    const res = await fetchWithRetry(this.name, "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.copt.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.copt.model,
        max_tokens: 8192,
        system,
        messages: [{ role: "user", content: user }],
      }),
    }, {
      retries: this.copt.retries ?? 5,
      classify: (status, body) => {
        if (/credit balance/i.test(body)) return "credit";
        if (status === 401 || status === 403) return "auth";
        return null;
      },
    });

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    this.usage.input += data.usage?.input_tokens ?? 0;
    this.usage.output += data.usage?.output_tokens ?? 0;
    const text = (data.content ?? []).filter(b => b.type === "text").map(b => b.text ?? "").join("");
    return { text, refused: data.stop_reason === "refusal" };
  }
}
