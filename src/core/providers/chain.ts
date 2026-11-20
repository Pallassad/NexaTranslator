import type { TranslationProvider } from "./types";
import { EngineUnavailable } from "./errors";
import { logWarn } from "../log";

/**
 * Chuỗi engine MIỄN PHÍ: dùng engine đầu tiên, engine đó bị chặn / hết quota
 * thì chuyển sang engine kế tiếp. Hết engine → ném EngineUnavailable("blocked")
 * để tool hỏi người dùng có muốn dùng AI (trả phí) không.
 */
export class ChainProvider implements TranslationProvider {
  private current = 0;
  paid = false;

  constructor(private providers: TranslationProvider[]) {
    if (providers.length === 0) throw new Error("Không có engine nào dùng được.");
  }

  get name() {
    return this.providers.length === 1
      ? this.providers[0].name
      : this.providers.map((p, i) => (i === this.current ? `[${p.name}]` : p.name)).join(" → ");
  }

  async translateBatch(texts: string[], from: string, to: string): Promise<(string | null)[]> {
    while (this.current < this.providers.length) {
      const p = this.providers[this.current];
      try {
        return await p.translateBatch(texts, from, to);
      } catch (e) {
        if (!(e instanceof EngineUnavailable)) throw e;
        const next = this.providers[this.current + 1];
        logWarn(`⛔ ${e.message}${next ? ` → chuyển sang ${next.name}` : ""}`);
        this.current++;
      }
    }
    throw new EngineUnavailable(this.providers.map(p => p.name).join(", "), "tất cả engine miễn phí đều đang bị chặn", "blocked");
  }
}
