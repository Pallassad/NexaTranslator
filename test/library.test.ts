import { describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addGame, AddGameError, createContext, getTool, listFiles, listGames, openGame, prepareTranslation,
  removeGame, runTranslate, updateGame, type AppEvent, type ProgressEvent,
} from "../src/app";

function fakeGame(parent: string, name = "Game", lines = 120): string {
  const root = join(parent, name);
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "js"), { recursive: true });
  mkdirSync(join(root, "icon"), { recursive: true });
  writeFileSync(join(root, "icon", "icon.png"), "png");
  writeFileSync(join(root, "js", "rmmz_core.js"), "");
  writeFileSync(join(root, "data", "System.json"), JSON.stringify({ gameTitle: "Test" }));
  writeFileSync(join(root, "data", "Actors.json"), JSON.stringify([null, { name: "Harold" }]));
  writeFileSync(join(root, "data", "MapInfos.json"), "[]");
  writeFileSync(join(root, "data", "Items.json"), JSON.stringify([null, { name: "Potion", description: "Heals a little.", note: "" }]));
  const events = Array.from({ length: lines }, (_, i) => ({ pages: [{ list: [
    { code: 401, parameters: [`Line number ${i} in Green Village.`] }, { code: 0, parameters: [] },
  ] }] }));
  writeFileSync(join(root, "data", "Map001.json"), JSON.stringify({ displayName: "Green Village", events: [null, ...events] }));
  return root;
}

const setup = () => {
  const base = mkdtempSync(join(tmpdir(), "lib-"));
  const events: AppEvent[] = [];
  const ctx = createContext({ workDir: join(base, "work"), emit: e => events.push(e) });
  mkdirSync(ctx.workDir, { recursive: true });
  return { base, ctx, events };
};

describe("thư viện game", () => {
  test("thêm, liệt kê, cập nhật, xóa – không ghi gì vào thư mục game", () => {
    const { base, ctx } = setup();
    const root = fakeGame(base);
    const before = readFileSync(join(root, "data", "Map001.json"), "utf8");

    const card = addGame(ctx, "rpgm", root);
    expect(card.name).toBe("Game");
    expect(card.engine).toBe("MZ");
    expect(card.formats[0].id).toBe("rpgm-data");
    expect(card.iconPath).toBe(join(root, "icon", "icon.png"));
    expect(card.progress).toBeUndefined();
    expect(card.exported).toBe(false);

    // Thêm lại cùng thư mục → không trùng
    addGame(ctx, "rpgm", root);
    expect(listGames(ctx, "rpgm")).toHaveLength(1);
    expect(listGames(ctx, "renpy")).toHaveLength(0);

    updateGame(ctx, card.id, { openedAt: 123 });
    expect(listGames(ctx, "rpgm")[0].openedAt).toBe(123);

    removeGame(ctx, card.id);
    expect(listGames(ctx, "rpgm")).toHaveLength(0);
    expect(existsSync(root)).toBe(true);
    expect(readFileSync(join(root, "data", "Map001.json"), "utf8")).toBe(before);
  });

  test("thư mục không phải game RPGM → lỗi kèm đoán loại game", () => {
    const { base, ctx } = setup();
    const renpy = join(base, "VN");
    mkdirSync(join(renpy, "game"), { recursive: true });
    writeFileSync(join(renpy, "game", "script.rpy"), "label start:");
    try {
      addGame(ctx, "rpgm", renpy);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AddGameError);
      expect((e as AddGameError).guess).toBe("Ren'Py");
    }
  });

  test("2 game trùng tên thư mục → báo lỗi (vì output/ và projects/ đặt theo tên thư mục)", () => {
    const { base, ctx } = setup();
    addGame(ctx, "rpgm", fakeGame(join(base, "a")));
    expect(() => addGame(ctx, "rpgm", fakeGame(join(base, "b")))).toThrow(/cùng tên thư mục/);
  });

  test("thẻ game đọc tiến độ từ progress.json, gộp đủ mọi file", async () => {
    const { base, ctx, events } = setup();
    const root = fakeGame(base);
    const card = addGame(ctx, "rpgm", root);
    const session = openGame(ctx, root, { adapters: getTool("rpgm").adapters });

    expect(listFiles(session).map(f => f.name).sort()).toEqual(["Actors.json", "Items.json", "Map001.json", "System.json"].filter(n =>
      session.fmt.files.some(f => f.name === n && f.hasText)).sort());

    // Chỉ dịch Items.json
    const plan = prepareTranslation(ctx, session, { files: ["Items.json"] });
    try { await runTranslate(ctx, session, plan, { engines: ["mock"] }); } finally { plan.close(); }

    const g = listGames(ctx, "rpgm").find(x => x.id === card.id)!;
    expect(g.progress!.lines).toBeGreaterThan(120);           // tính cả Map001.json chưa dịch
    expect(g.progress!.translated).toBeLessThan(g.progress!.lines);

    const files = listFiles(session);
    expect(files.find(f => f.name === "Items.json")!.translated).toBe(files.find(f => f.name === "Items.json")!.lines);
    expect(files.find(f => f.name === "Map001.json")!.translated).toBe(0);

    // Dịch tiếp Map001 → không làm mất dòng của Items.json
    // Lần 1 đã dịch trước tên khu vực (giai đoạn 1) dù chỉ chọn Items.json
    expect(events.some(e => e.type === "progress" && e.phase === "map-names")).toBe(true);
    const plan2 = prepareTranslation(ctx, session, { files: ["Map001.json"] });
    events.length = 0;
    try { await runTranslate(ctx, session, plan2, { engines: ["mock"] }); } finally { plan2.close(); }
    const after = listFiles(session);
    expect(after.find(f => f.name === "Items.json")!.translated).toBeGreaterThan(0);

    // Tiến độ tổng: tăng dần, kết thúc bằng tổng
    const prog = events.filter((e): e is ProgressEvent => e.type === "progress");
    expect(prog.length).toBeGreaterThan(1);
    const last = prog.at(-1)!;
    expect(last.overallDone).toBe(last.overallTotal);
    for (let i = 1; i < prog.length; i++) expect(prog[i].overallDone).toBeGreaterThanOrEqual(prog[i - 1].overallDone);
  });
});
