import type { Pricing, TranslationProvider, Usage } from "./types";
import { EngineUnavailable } from "./errors";

/**
 * Provider giả để test (không gọi mạng):
 * - "mock"     : miễn phí, thêm "[VI] " vào trước câu.
 *                Đặt biến môi trường MOCK_BLOCK_AFTER=n để giả lập bị chặn sau n lô.
 *                MOCK_DELAY_MS=n: mỗi lô chờ n ms (để xem thanh tiến độ khi kiểm thử giao diện).
 *                MOCK_BREAK_CODES=1: làm mất mã {1} trong câu (giả lập Google làm hỏng mã điều khiển).
 * - "mock-ai"  : giả lập AI trả phí – đếm token, có giá; câu chứa "REFUSE" bị từ chối (null).
 */
const delay = () => {
  const ms = Number(process.env.MOCK_DELAY_MS);
  return ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();
};

export class MockProvider implements TranslationProvider {
  name = "Mock";
  private calls = 0;
  async translateBatch(texts: string[]): Promise<(string | null)[]> {
    const limit = Number(process.env.MOCK_BLOCK_AFTER);
    if (limit && ++this.calls > limit) throw new EngineUnavailable(this.name, "giả lập bị chặn", "blocked");
    await delay();
    const brk = process.env.MOCK_BREAK_CODES === "1";
    return texts.map(t => "[VI] " + (brk ? t.replace("{1}", "") : t));
  }
}

export class MockAIProvider implements TranslationProvider {
  name = "Mock AI";
  paid = true;
  pricing: Pricing = { input: 1, output: 2 };
  usage: Usage = { input: 0, output: 0 };
  async translateBatch(texts: string[]): Promise<(string | null)[]> {
    await delay();
    const chars = texts.join("").length;
    this.usage.input += Math.ceil(chars / 3.5) + 300;
    this.usage.output += Math.ceil(chars / 2);
    return texts.map(t => (t.includes("REFUSE") ? null : "[AI] " + t));
  }
}
