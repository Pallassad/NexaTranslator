import { afterEach, describe, expect, test, vi } from "vitest";
import { AzureProvider } from "../src/core/providers/azure";
import { DeepLProvider } from "../src/core/providers/deepl";
import { AIProvider, parseJsonArray } from "../src/core/providers/ai";
import { ClaudeProvider } from "../src/core/providers/claude";
import { costOf } from "../src/core/providers/types";
import { ChainProvider } from "../src/core/providers/chain";
import { EngineUnavailable } from "../src/core/providers/errors";
import type { TranslationProvider } from "../src/core/providers/types";

/** Giả lập fetch: ghi lại request và trả response do test quyết định. */
function mockFetch(handler: (url: string, init: any) => { status?: number; body: unknown }) {
  const calls: { url: string; init: any }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Azure", () => {
  test("gửi đúng header/tham số và đọc kết quả", async () => {
    const calls = mockFetch((_u, init) => ({
      body: JSON.parse(init.body).map((x: any) => ({ translations: [{ text: "VI:" + x.Text }] })),
    }));
    const p = new AzureProvider({ key: "K", region: "southeastasia" });
    expect(await p.translateBatch(["Hi", "Bye"], "zh-CN", "vi")).toEqual(["VI:Hi", "VI:Bye"]);
    expect(calls[0].url).toContain("to=vi");
    expect(calls[0].url).toContain("from=zh-Hans");
    expect(calls[0].init.headers["Ocp-Apim-Subscription-Region"]).toBe("southeastasia");
  });

  test("hết quota (403) → EngineUnavailable", async () => {
    mockFetch(() => ({ status: 403, body: {} }));
    await expect(new AzureProvider({ key: "K" }).translateBatch(["Hi"], "en", "vi"))
      .rejects.toBeInstanceOf(EngineUnavailable);
  });
});

describe("DeepL", () => {
  test("key :fx dùng api-free, mã ngôn ngữ viết hoa", async () => {
    const calls = mockFetch((_u, init) => ({
      body: { translations: JSON.parse(init.body).text.map((t: string) => ({ text: "VI:" + t })) },
    }));
    const r = await new DeepLProvider({ key: "abc:fx" }).translateBatch(["Hi"], "ja", "vi");
    expect(r).toEqual(["VI:Hi"]);
    expect(calls[0].url).toBe("https://api-free.deepl.com/v2/translate");
    const body = JSON.parse(calls[0].init.body);
    expect([body.target_lang, body.source_lang]).toEqual(["VI", "JA"]);
  });

  test("456 = hết quota → EngineUnavailable", async () => {
    mockFetch(() => ({ status: 456, body: {} }));
    await expect(new DeepLProvider({ key: "abc:fx" }).translateBatch(["Hi"], "en", "vi"))
      .rejects.toBeInstanceOf(EngineUnavailable);
  });
});

describe("AI", () => {
  test("đọc mảng JSON kể cả khi bọc trong ```json", () => {
    expect(parseJsonArray('Here:\n```json\n["a","b"]\n```')).toEqual(["a", "b"]);
    expect(parseJsonArray("không có mảng")).toBeNull();
  });

  test("AI trả sai số câu → tự chia đôi và dịch lại", async () => {
    let n = 0;
    mockFetch((_u, init) => {
      const texts: string[] = JSON.parse(JSON.parse(init.body).messages[1].content);
      n++;
      // Lần đầu (3 câu) cố tình trả thiếu; các lần sau trả đúng
      const out = texts.length === 3 ? ["x"] : texts.map(t => "VI:" + t);
      return { body: { choices: [{ message: { content: "```json\n" + JSON.stringify(out) + "\n```" } }] } };
    });
    const p = new AIProvider({ apiKey: "K", baseUrl: "https://x/v1/", model: "m", delayMs: 0 });
    expect(await p.translateBatch(["a", "b", "c"], "en", "vi")).toEqual(["VI:a", "VI:b", "VI:c"]);
    expect(n).toBe(3); // 1 lần lỗi + 2 nửa
  });
});

describe("ChainProvider", () => {
  const ok = (name: string): TranslationProvider => ({ name, translateBatch: async t => t.map(x => `${name}:${x}`) });
  const down = (name: string): TranslationProvider => ({
    name, translateBatch: async () => { throw new EngineUnavailable(name, "bị chặn"); },
  });

  test("engine đầu bị chặn → tự chuyển engine sau và giữ luôn engine đó", async () => {
    const chain = new ChainProvider([down("Google"), ok("Azure")]);
    expect(await chain.translateBatch(["a"], "en", "vi")).toEqual(["Azure:a"]);
    expect(await chain.translateBatch(["b"], "en", "vi")).toEqual(["Azure:b"]);
    expect(chain.name).toBe("Google → [Azure]");
  });

  test("tất cả bị chặn → báo lỗi rõ ràng", async () => {
    await expect(new ChainProvider([down("A"), down("B")]).translateBatch(["a"], "en", "vi"))
      .rejects.toBeInstanceOf(EngineUnavailable);
  });
});

describe("Claude", () => {
  const reply = (content: string, extra: object = {}) => ({
    body: { content: [{ type: "text", text: content }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 }, ...extra },
  });

  test("gửi đúng header, đọc kết quả, cộng token và tính chi phí", async () => {
    const calls = mockFetch((_u, init) => {
      const texts: string[] = JSON.parse(JSON.parse(init.body).messages[0].content);
      return reply(JSON.stringify(texts.map(t => "VI:" + t)));
    });
    const p = new ClaudeProvider({ apiKey: "sk-test", model: "claude-haiku-5-5", pricing: { input: 0.1, output: 0.5 }, delayMs: 0 });
    expect(await p.translateBatch(["a", "b"], "en", "vi")).toEqual(["VI:a", "VI:b"]);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].init.headers["x-api-key"]).toBe("sk-test");
    expect(p.usage).toEqual({ input: 100, output: 50 });
    expect(costOf(p)).toBeCloseTo((100 * 0.1 + 50 * 0.5) / 1e6);
    expect(p.paid).toBe(true);
  });

  test("từ chối dịch (stop_reason refusal) → câu đó thành null, câu khác vẫn dịch", async () => {
    mockFetch((_u, init) => {
      const texts: string[] = JSON.parse(JSON.parse(init.body).messages[0].content);
      if (texts.some(t => t.includes("BAD"))) return reply("", { stop_reason: "refusal" });
      return reply(JSON.stringify(texts.map(t => "VI:" + t)));
    });
    const p = new ClaudeProvider({ apiKey: "k", model: "m", delayMs: 0 });
    expect(await p.translateBatch(["ok1", "BAD", "ok2"], "en", "vi")).toEqual(["VI:ok1", null, "VI:ok2"]);
  });

  test("hết credit → EngineUnavailable kind credit", async () => {
    mockFetch(() => ({ status: 400, body: { type: "error", error: { message: "Your credit balance is too low to access the Anthropic API." } } }));
    const p = new ClaudeProvider({ apiKey: "k", model: "m" });
    await expect(p.translateBatch(["a"], "en", "vi")).rejects.toMatchObject({ kind: "credit" });
  });
});
