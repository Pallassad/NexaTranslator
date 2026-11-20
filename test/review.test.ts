import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createContext, fixError, getTool, listErrors, listFiles, openGame, prepareTranslation, retranslateErrors,
  keepOriginal, runTranslate, writeOutput, reviewedLines, type PaidOffer,
} from "../src/app";

function fakeGame(base: string) {
  const root = join(base, "Game");
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "js"), { recursive: true });
  writeFileSync(join(root, "js", "rmmz_core.js"), "");
  writeFileSync(join(root, "data", "System.json"), "{}");
  writeFileSync(join(root, "data", "MapInfos.json"), "[]");
  const list = [
    { code: 401, parameters: ["The \\C[2]Old Bridge\\C[0] is north of here."] }, { code: 0, parameters: [] },
  ];
  const events = [
    { pages: [{ list }] },
    { pages: [{ list: [{ code: 401, parameters: ["Take the \\C[3]key\\C[0] with you."] }, { code: 0, parameters: [] }] }] },
    { pages: [{ list: [{ code: 401, parameters: ["Good morning."] }, { code: 0, parameters: [] }] }] },
  ];
  writeFileSync(join(root, "data", "Map001.json"), JSON.stringify({ displayName: "", events: [null, ...events] }));
  return root;
}

afterEach(() => { delete process.env.MOCK_BREAK_CODES; });

describe("xem lại dòng lỗi mã điều khiển", () => {
  test("liệt kê → sửa tay (kiểm tra đủ mã) → giữ gốc → AI dịch lại", async () => {
    const base = mkdtempSync(join(tmpdir(), "rev-"));
    const root = fakeGame(base);
    let askedPaid: PaidOffer | null = null;
    const ctx = createContext({
      workDir: join(base, "w"),
      prompt: { confirmPaid: async o => { askedPaid = o; return true; }, askKey: async () => null, confirmSaveKey: async () => false },
    });
    // Engine trả phí giả (không cần key)
    ctx.cfg.paidEngine = "mock-ai";
    const session = openGame(ctx, root, { adapters: getTool("rpgm").adapters });

    process.env.MOCK_BREAK_CODES = "1";
    let plan = prepareTranslation(ctx, session);
    const r = await runTranslate(ctx, session, plan, { engines: ["mock"] });
    plan.close();
    expect(r.errorCount).toBe(2);
    // File vẫn tính là "xong": dòng lỗi được giữ bản gốc
    const map = listFiles(session).find(f => f.name === "Map001.json")!;
    expect(map.kept).toBe(2);
    expect(map.translated! + map.kept!).toBe(map.lines);
    delete process.env.MOCK_BREAK_CODES;

    plan = prepareTranslation(ctx, session);
    try {
      let errs = listErrors(session, plan);
      expect(errs).toHaveLength(2);
      const bridge = errs.find(e => e.source.includes("Bridge"))!;
      expect(bridge.segments[0].tokens).toEqual(["\\C[2]", "\\C[0]"]);
      expect(bridge.reason).toMatch(/mất/);

      // Thiếu mã → không cho lưu
      expect(() => fixError(plan, bridge.key, ["{0}Cầu Cũ nằm phía bắc."])).toThrow(/mất/);
      expect(() => fixError(plan, bridge.key, ["{0}Cầu{0} Cũ{1} nằm phía bắc."])).toThrow(/lặp/);
      // Đủ mã → lưu
      fixError(plan, bridge.key, ["{0}Cầu Cũ{1} nằm ở phía bắc."]);
      errs = listErrors(session, plan);
      expect(errs).toHaveLength(1);

      // Giữ gốc → ẩn khỏi danh sách
      keepOriginal(session, plan, [errs[0].key]);
      expect(listErrors(session, plan)).toHaveLength(0);
      expect(reviewedLines(session)).toBe(1);

      writeOutput(ctx, session, plan);
      const out = readFileSync(join(session.fmtOut, "Map001.json"), "utf8");
      expect(out).toContain("\\\\C[2]Cầu Cũ\\\\C[0] nằm ở phía bắc.");
      expect(out).toContain("Take the \\\\C[3]key\\\\C[0] with you.");   // giữ gốc
    } finally {
      plan.close();
    }
  });

  test("AI dịch lại: hỏi trước, chỉ lưu bản giữ đủ mã", async () => {
    const base = mkdtempSync(join(tmpdir(), "rev2-"));
    const root = fakeGame(base);
    let asked = 0;
    const ctx = createContext({
      workDir: join(base, "w"),
      prompt: { confirmPaid: async () => { asked++; return true; }, askKey: async () => null, confirmSaveKey: async () => false },
    });
    ctx.cfg.paidEngine = "mock-ai";
    const session = openGame(ctx, root, { adapters: getTool("rpgm").adapters });
    process.env.MOCK_BREAK_CODES = "1";
    let plan = prepareTranslation(ctx, session);
    await runTranslate(ctx, session, plan, { engines: ["mock"] });
    plan.close();
    delete process.env.MOCK_BREAK_CODES;

    plan = prepareTranslation(ctx, session);
    try {
      const keys = listErrors(session, plan).map(e => e.key);
      const r = await retranslateErrors(ctx, plan, keys);
      expect(asked).toBe(1);
      expect(r.cancelled).toBe(false);
      expect(r.fixed).toBe(2);
      expect(r.costUsd).toBeGreaterThan(0);
      expect(listErrors(session, plan)).toHaveLength(0);
    } finally {
      plan.close();
    }
  });
});
