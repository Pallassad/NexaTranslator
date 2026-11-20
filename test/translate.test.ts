import { describe, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Entry } from "../src/core/types";
import { buildUnits } from "../src/core/units";
import { TranslationMemory } from "../src/core/memory";
import { pendingSegments, translatePending, assembleUnits, newStats, StopTranslation } from "../src/core/translate";
import { MockAIProvider } from "../src/core/providers/mock";
import { EngineUnavailable } from "../src/core/providers/errors";
import type { TranslationProvider } from "../src/core/providers/types";

const entry = (i: number, source: string): Entry => ({ file: "Items.json", path: [i, "name"], kind: "name", source });
const newTm = () => new TranslationMemory(join(mkdtempSync(join(tmpdir(), "tr-")), "memory.db"));
const opt = { from: "auto", to: "vi" };

describe("translatePending + assembleUnits", () => {
  test("AI từ chối → dùng engine dự phòng; báo cáo đúng số câu", async () => {
    const es = [entry(1, "Potion"), entry(2, "REFUSE this"), entry(3, "Ether")];
    const units = buildUnits(es, { maxChars: 40 });
    const tm = newTm();
    const google: TranslationProvider = { name: "Google", translateBatch: async t => t.map(x => "[G] " + x) };
    const stats = newStats();
    await translatePending(pendingSegments(units, tm, "auto", "vi"), new MockAIProvider(), tm, { ...opt, fallback: google }, stats);
    expect(stats.byEngine.get("Mock AI")).toBe(2);
    expect(stats.fallbackUsed).toBe(1);
    assembleUnits(units, tm, "auto", "vi");
    expect(es.map(e => e.target)).toEqual(["[AI] Potion", "[G] REFUSE this", "[AI] Ether"]);
  });

  test("chạm max-cost → dừng, phần đã dịch vẫn ở trong memory và xuất được", async () => {
    const es = Array.from({ length: 100 }, (_, i) => entry(i + 1, `Item number ${i}`));
    const units = buildUnits(es, { maxChars: 40 });
    const tm = newTm();
    const ai = new MockAIProvider();
    await expect(translatePending(pendingSegments(units, tm, "auto", "vi"), ai, tm,
      { ...opt, batchSize: 10, maxCost: 0.0001 }, newStats())).rejects.toBeInstanceOf(StopTranslation);
    const left = pendingSegments(units, tm, "auto", "vi").length;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(100);
    const { untranslated } = assembleUnits(units, tm, "auto", "vi");
    expect(untranslated).toBe(left);
    expect(es.filter(e => e.target).length).toBe(100 - left);
  });

  test("engine bị chặn giữa chừng → lỗi EngineUnavailable, chạy lại chỉ dịch phần còn thiếu", async () => {
    const es = Array.from({ length: 20 }, (_, i) => entry(i + 1, `Line ${i}`));
    const units = buildUnits(es, { maxChars: 40 });
    const tm = newTm();
    let calls = 0;
    const flaky: TranslationProvider = {
      name: "Flaky",
      translateBatch: async t => { if (++calls > 1) throw new EngineUnavailable("Flaky", "bị chặn"); return t.map(x => "F:" + x); },
    };
    await expect(translatePending(pendingSegments(units, tm, "auto", "vi"), flaky, tm, { ...opt, batchSize: 5 }, newStats()))
      .rejects.toBeInstanceOf(EngineUnavailable);
    const rest = pendingSegments(units, tm, "auto", "vi");
    expect(rest).toHaveLength(15);
    const ai = new MockAIProvider();
    await translatePending(rest, ai, tm, { ...opt, batchSize: 5 }, newStats());
    expect(pendingSegments(units, tm, "auto", "vi")).toHaveLength(0);
  });
});
