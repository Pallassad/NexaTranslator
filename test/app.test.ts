import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createContext, openGame, prepareTranslation, runTranslate,
  type AppEvent, type PaidOffer, type Prompter,
} from "../src/app";
import { logWarn } from "../src/core/log";

/** Game MZ giả: 1 map có tên khu vực + nhiều dòng thoại (đủ nhiều lô). */
function fakeGame(): string {
  const root = join(mkdtempSync(join(tmpdir(), "app-")), "Game");
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "js"), { recursive: true });
  writeFileSync(join(root, "js", "rmmz_core.js"), "");
  writeFileSync(join(root, "data", "System.json"), JSON.stringify({ gameTitle: "Test" }));
  writeFileSync(join(root, "data", "Actors.json"), JSON.stringify([null, { name: "Harold" }]));
  writeFileSync(join(root, "data", "MapInfos.json"), "[]");
  // Mỗi câu 1 event riêng → không bị gộp, đủ nhiều lô (lô 50 câu)
  const events = Array.from({ length: 120 }, (_, i) => ({ pages: [{ list: [
    { code: 401, parameters: [`Line number ${i} in Green Village.`] }, { code: 0, parameters: [] },
  ] }] }));
  writeFileSync(join(root, "data", "Map001.json"), JSON.stringify({ displayName: "Green Village", events: [null, ...events] }));
  return root;
}

/** Tạo context ghi lại mọi sự kiện + Prompter giả. */
function setup(prompt: Partial<Prompter> = {}) {
  const events: AppEvent[] = [];
  const asked: { paid: PaidOffer[]; keys: number } = { paid: [], keys: 0 };
  const ctx = createContext({
    workDir: mkdtempSync(join(tmpdir(), "work-")),
    emit: e => events.push(e),
    prompt: {
      confirmPaid: async o => { asked.paid.push(o); return prompt.confirmPaid ? prompt.confirmPaid(o) : false; },
      askKey: async r => { asked.keys++; return prompt.askKey ? prompt.askKey(r) : null; },
      confirmSaveKey: async () => false,
    },
  });
  return { ctx, events, asked };
}

const ofType = <T extends AppEvent["type"]>(events: AppEvent[], type: T) =>
  events.filter((e): e is Extract<AppEvent, { type: T }> => e.type === type);

afterEach(() => { delete process.env.MOCK_BLOCK_AFTER; });

describe("app: runTranslate", () => {
  test("dịch hết bằng engine miễn phí: phát sự kiện, ghi file, không hỏi gì", async () => {
    const { ctx, events, asked } = setup();
    const session = openGame(ctx, fakeGame());
    const plan = prepareTranslation(ctx, session);
    try {
      const r = await runTranslate(ctx, session, plan, { engines: ["mock"] });
      expect(r.status).toBe("done");
      expect(r.files.every(f => f.translated === f.lines)).toBe(true);
      expect(existsSync(join(session.fmtOut, "Map001.json"))).toBe(true);
      expect(existsSync(r.progressPath)).toBe(true);
    } finally { plan.close(); }

    expect(ofType(events, "snapshot")).toHaveLength(1);
    expect(ofType(events, "translate-start")[0].engine).toBe("Mock");
    expect(ofType(events, "phase").map(e => e.phase)).toEqual(["map-names", "main"]);
    const last = ofType(events, "progress").at(-1)!;
    expect(last.done).toBe(last.total);
    expect(asked.paid).toHaveLength(0);
  });

  test("engine miễn phí bị chặn → HỎI trước khi dùng trả phí; từ chối → dừng, vẫn xuất phần đã dịch", async () => {
    process.env.MOCK_BLOCK_AFTER = "2";
    const { ctx, events, asked } = setup({ confirmPaid: async () => false });
    const session = openGame(ctx, fakeGame());
    const plan = prepareTranslation(ctx, session);
    try {
      const r = await runTranslate(ctx, session, plan, { engines: ["mock", "mock-ai"] });
      expect(r.status).toBe("stopped");
      expect(r.stopReason).toBe("Không dùng engine trả phí");
      expect(asked.paid).toHaveLength(1);
      expect(asked.paid[0].sentences).toBeGreaterThan(0);
      const done = r.files.reduce((n, f) => n + f.translated, 0);
      expect(done).toBeGreaterThan(0);
      expect(existsSync(join(session.fmtOut, "Map001.json"))).toBe(true);
    } finally { plan.close(); }
    expect(ofType(events, "engine-unavailable").length).toBeGreaterThan(0);
  });

  test("đồng ý dùng trả phí → chuyển engine, báo token + chi phí", async () => {
    process.env.MOCK_BLOCK_AFTER = "1";
    const { ctx, events } = setup({ confirmPaid: async () => true });
    const session = openGame(ctx, fakeGame());
    const plan = prepareTranslation(ctx, session);
    try {
      const r = await runTranslate(ctx, session, plan, { engines: ["mock", "mock-ai"] });
      expect(r.status).toBe("done");
      const ai = r.engines.find(u => u.engine === "Mock AI")!;
      expect(ai.paid).toBe(true);
      expect(ai.tokensIn).toBeGreaterThan(0);
    } finally { plan.close(); }
    expect(ofType(events, "engine-switch")[0].engine).toBe("Mock AI");
  });

  test("chọn AI từ đầu → hỏi chi phí TRƯỚC khi dịch câu nào; đồng ý → toàn bộ dịch bằng AI", async () => {
    const { ctx, asked } = setup({ confirmPaid: async () => true });
    const session = openGame(ctx, fakeGame());
    const plan = prepareTranslation(ctx, session);
    try {
      const r = await runTranslate(ctx, session, plan, { engines: ["mock-ai"] });
      expect(r.status).toBe("done");
      expect(asked.paid).toHaveLength(1);
      expect(r.engines.map(u => u.engine)).toEqual(["Mock AI"]);
    } finally { plan.close(); }
  });

  test("chọn AI từ đầu nhưng từ chối → không dịch gì", async () => {
    const { ctx } = setup({ confirmPaid: async () => false });
    const session = openGame(ctx, fakeGame());
    const plan = prepareTranslation(ctx, session);
    try {
      await runTranslate(ctx, session, plan, { engines: ["mock-ai"] });
      expect(plan.pending().length).toBeGreaterThan(100);
    } finally { plan.close(); }
  });

  test("nút Dừng (AbortSignal) → dừng sau lô hiện tại", async () => {
    const stop = new AbortController();
    const { ctx } = setup();
    const emit = ctx.emit;
    ctx.emit = e => { emit(e); if (e.type === "progress" && e.total > 50) stop.abort(); };
    const session = openGame(ctx, fakeGame());
    const plan = prepareTranslation(ctx, session);
    try {
      const r = await runTranslate(ctx, session, plan, { engines: ["mock"], signal: stop.signal });
      expect(r.status).toBe("stopped");
      expect(r.stopReason).toBe("Đã dừng theo yêu cầu");
      const done = r.files.reduce((n, f) => n + f.translated, 0);
      const total = r.files.reduce((n, f) => n + f.lines, 0);
      expect(done).toBeLessThan(total);
    } finally { plan.close(); }
  });

  test("chỉ có engine trả phí, chưa có key → hỏi key; hủy → không ghi gì", async () => {
    const saved = process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    try {
      const { ctx, asked } = setup({ confirmPaid: async () => true, askKey: async () => null });
      const session = openGame(ctx, fakeGame());
      const plan = prepareTranslation(ctx, session);
      try {
        const r = await runTranslate(ctx, session, plan, { engines: ["claude"] });
        expect(r.status).toBe("cancelled");
        expect(asked.keys).toBe(1);
        expect(existsSync(session.fmtOut)).toBe(false);
      } finally { plan.close(); }
    } finally {
      if (saved !== undefined) process.env.CLAUDE_API_KEY = saved;
    }
  });
});

test("thông báo phụ của lõi (thử lại, đổi engine...) thành sự kiện log", () => {
  const { events } = setup();
  logWarn("⚠ Google: HTTP 429 – thử lại sau 2s...");
  expect(events).toContainEqual({ type: "log", level: "warn", message: "⚠ Google: HTTP 429 – thử lại sau 2s..." });
});
