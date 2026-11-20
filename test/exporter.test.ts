import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportToGame, restoreGame } from "../src/core/exporter";

/** Tạo bố cục: game/data (bản gốc), projects/g/source (bản chép gốc), output/data (bản dịch). */
function setup() {
  const root = mkdtempSync(join(tmpdir(), "exp-"));
  const dirs = {
    gameDataDir: join(root, "game", "data"),
    sourceDir: join(root, "projects", "g", "source"),
    projDir: join(root, "projects", "g"),
    outDataDir: join(root, "output", "data"),
  };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const [n, v] of [["Map001.json", "EN1"], ["Items.json", "EN2"]]) {
    writeFileSync(join(dirs.gameDataDir, n), v);
    writeFileSync(join(dirs.sourceDir, n), v);
    writeFileSync(join(dirs.outDataDir, n), "VI-" + v);
  }
  const read = (n: string) => readFileSync(join(dirs.gameDataDir, n), "utf8");
  return { ...dirs, read };
}

describe("export / restore", () => {
  test("lần đầu: chép bản dịch vào game; khôi phục: về bản gốc", () => {
    const s = setup();
    const r = exportToGame(s);
    expect(r.map(x => [x.name, x.status, x.written])).toEqual([["Items.json", "new", true], ["Map001.json", "new", true]]);
    expect(s.read("Map001.json")).toBe("VI-EN1");

    const back = restoreGame(s);
    expect(back.every(x => x.status === "restored" && x.written)).toBe(true);
    expect(s.read("Map001.json")).toBe("EN1");
    expect(restoreGame(s)).toEqual([]); // không còn gì để khôi phục
  });

  test("dịch lại rồi xuất lần 2: ghi đè bản tool xuất trước đó (update)", () => {
    const s = setup();
    exportToGame(s);
    writeFileSync(join(s.outDataDir, "Map001.json"), "VI2-EN1");
    const r = exportToGame(s);
    expect(r.find(x => x.name === "Map001.json")!.status).toBe("update");
    expect(r.find(x => x.name === "Items.json")!.status).toBe("same");
    expect(s.read("Map001.json")).toBe("VI2-EN1");
    restoreGame(s);
    expect(s.read("Map001.json")).toBe("EN1");
  });

  test("file trong game bị thay đổi bởi thứ khác → xung đột, KHÔNG ghi đè", () => {
    const s = setup();
    writeFileSync(join(s.gameDataDir, "Map001.json"), "GAME-UPDATE");
    const r = exportToGame(s);
    expect(r.find(x => x.name === "Map001.json")).toMatchObject({ status: "conflict", written: false });
    expect(s.read("Map001.json")).toBe("GAME-UPDATE");
    expect(s.read("Items.json")).toBe("VI-EN2"); // file khác vẫn xuất bình thường
  });

  test("--force: ghi đè file xung đột nhưng backup trước", () => {
    const s = setup();
    writeFileSync(join(s.gameDataDir, "Map001.json"), "GAME-UPDATE");
    const r = exportToGame({ ...s, force: true });
    const m = r.find(x => x.name === "Map001.json")!;
    expect(m).toMatchObject({ status: "conflict", written: true });
    expect(readFileSync(m.backup!, "utf8")).toBe("GAME-UPDATE");
    expect(s.read("Map001.json")).toBe("VI-EN1");
  });

  test("khôi phục: file bị sửa sau khi xuất → xung đột, giữ nguyên", () => {
    const s = setup();
    exportToGame(s);
    writeFileSync(join(s.gameDataDir, "Items.json"), "EDITED");
    const r = restoreGame(s);
    expect(r.find(x => x.name === "Items.json")).toMatchObject({ status: "conflict", written: false });
    expect(s.read("Items.json")).toBe("EDITED");
    expect(s.read("Map001.json")).toBe("EN1");
  });

  test("chạy thử (dryRun) không ghi gì", () => {
    const s = setup();
    exportToGame({ ...s, dryRun: true });
    expect(s.read("Map001.json")).toBe("EN1");
    expect(existsSync(join(s.projDir, "export.json"))).toBe(false);
    expect(readdirSync(s.projDir)).toEqual(["source"]);
  });
});

describe("export / restore thư mục fonts (file mới + file bị thay)", () => {
  test("font mới được thêm vào game; restore thì xóa đi, gamefont.css về bản gốc", () => {
    const s = setup();
    const root = join(s.gameDataDir, "..", "..");
    const gameFonts = join(s.gameDataDir, "..", "fonts");
    const outFonts = join(root, "output", "fonts");
    const srcFonts = join(s.projDir, "source-fonts");
    for (const d of [gameFonts, outFonts, srcFonts]) mkdirSync(d, { recursive: true });
    writeFileSync(join(gameFonts, "gamefont.css"), "OLD-CSS");
    writeFileSync(join(srcFonts, "gamefont.css"), "OLD-CSS");
    writeFileSync(join(outFonts, "gamefont.css"), "NEW-CSS");
    writeFileSync(join(outFonts, "BeVietnamPro-Regular.ttf"), "FONT");
    const extra = [{ prefix: "fonts/", outDir: outFonts, gameDir: gameFonts, sourceDir: srcFonts }];

    const r = exportToGame({ ...s, extra });
    expect(r.filter(x => x.name.startsWith("fonts/")).map(x => [x.name, x.status])).toEqual([
      ["fonts/BeVietnamPro-Regular.ttf", "new"], ["fonts/gamefont.css", "new"],
    ]);
    expect(readFileSync(join(gameFonts, "gamefont.css"), "utf8")).toBe("NEW-CSS");
    expect(existsSync(join(gameFonts, "BeVietnamPro-Regular.ttf"))).toBe(true);

    restoreGame({ ...s, extra });
    expect(readFileSync(join(gameFonts, "gamefont.css"), "utf8")).toBe("OLD-CSS");
    expect(existsSync(join(gameFonts, "BeVietnamPro-Regular.ttf"))).toBe(false);
  });
});
