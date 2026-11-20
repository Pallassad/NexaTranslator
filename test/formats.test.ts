import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectFormats, pickFormat } from "../src/formats/registry";
import { exportToGame, restoreGame, type FileGroup } from "../src/core/exporter";

/** Game MZ giả: 1 map có 1 dòng thoại + Actors.json. */
function fakeGame() {
  const root = mkdtempSync(join(tmpdir(), "fmt-"));
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "js"), { recursive: true });
  writeFileSync(join(root, "js", "rmmz_core.js"), "");
  writeFileSync(join(root, "data", "System.json"), JSON.stringify({ gameTitle: "Test" }));
  writeFileSync(join(root, "data", "Actors.json"), JSON.stringify([null, { name: "Harold" }]));
  writeFileSync(join(root, "data", "MapInfos.json"), "[]");
  writeFileSync(join(root, "data", "Map001.json"), JSON.stringify({
    displayName: "", events: [null, { pages: [{ list: [
      { code: 101, parameters: ["", 0, 0, 2, "Harold"] },
      { code: 401, parameters: ["Hello there."] },
      { code: 0, parameters: [] },
    ] }] }],
  }));
  return root;
}

describe("registry", () => {
  test("nhận diện game RPGM → rpgm-data", () => {
    const fs = detectFormats(fakeGame());
    expect(fs.map(f => f.id)).toEqual(["rpgm-data"]);
    expect(fs[0].rpgm?.engine).toBe("MZ");
    const byName = Object.fromEntries(fs[0].files.map(f => [f.name, f.hasText]));
    expect(byName).toMatchObject({ "Map001.json": true, "System.json": true, "Actors.json": true, "MapInfos.json": false });
  });

  test("không phải game → báo lỗi dễ hiểu", () => {
    expect(() => detectFormats(mkdtempSync(join(tmpdir(), "fmt-")))).toThrow(/Không tìm thấy/);
  });

  test("--format sai → báo các định dạng có", () => {
    const fs = detectFormats(fakeGame());
    expect(pickFormat(fs).id).toBe("rpgm-data");
    expect(() => pickFormat(fs, "renpy")).toThrow(/Có: rpgm-data/);
  });
});

describe("bộ đọc rpgm-data", () => {
  test("chụp bản gốc, đọc chữ, ghi bản dịch", () => {
    const root = fakeGame();
    const work = mkdtempSync(join(tmpdir(), "work-"));
    const paths = { root, outDir: join(work, "output"), projDir: join(work, "projects") };
    const fmt = detectFormats(root)[0];

    expect(fmt.snapshot(paths, false).created).toBe(true);
    expect(fmt.snapshot(paths, false).created).toBe(false);
    const src = fmt.sourceDir(paths);
    expect(existsSync(join(src, "Map001.json"))).toBe(true);

    const file = fmt.load(src, "Map001.json");
    expect(file.roundtripOk()).toBe(true);
    const dialogue = file.entries.find(e => e.kind === "dialogue")!;
    expect(dialogue.source).toBe("Hello there.");

    const out = join(paths.outDir, fmt.outSubdir, "Map001.json");
    file.write(out, file.entries.map(e => (e === dialogue ? { ...e, target: "Xin chào." } : e)));
    expect(readFileSync(out, "utf8")).toContain("Xin chào.");
    expect(readFileSync(out, "utf8")).toContain("Harold"); // tên người nói không đổi

    expect(fmt.keepNames?.(src)).toEqual(["Harold"]);
  });
});

describe("export nhiều nhóm", () => {
  /** 2 nhóm: data/ (prefix "") và csv/, mỗi nhóm 1 file. */
  function setup() {
    const r = mkdtempSync(join(tmpdir(), "grp-"));
    const mk = (prefix: string, sub: string, file: string): FileGroup => {
      const g: FileGroup = {
        prefix, outDir: join(r, "out", sub), gameDir: join(r, "game", sub),
        sourceDir: join(r, "proj", "src-" + sub), requireSource: true,
      };
      for (const d of [g.outDir, g.gameDir, g.sourceDir]) mkdirSync(d, { recursive: true });
      writeFileSync(join(g.gameDir, file), "EN");
      writeFileSync(join(g.sourceDir, file), "EN");
      writeFileSync(join(g.outDir, file), "VI");
      return g;
    };
    return { projDir: join(r, "proj"), data: mk("", "data", "Map001.json"), csv: mk("csv/", "csv", "sheet.csv") };
  }

  test("export tất cả nhóm; restore khôi phục đúng chỗ", () => {
    const s = setup();
    const res = exportToGame({ projDir: s.projDir, groups: [s.data, s.csv] });
    expect(res.map(r => [r.name, r.status])).toEqual([["Map001.json", "new"], ["csv/sheet.csv", "new"]]);
    expect(readFileSync(join(s.csv.gameDir, "sheet.csv"), "utf8")).toBe("VI");

    restoreGame({ projDir: s.projDir, groups: [s.data, s.csv] });
    expect(readFileSync(join(s.csv.gameDir, "sheet.csv"), "utf8")).toBe("EN");
    expect(readFileSync(join(s.data.gameDir, "Map001.json"), "utf8")).toBe("EN");
  });

  test("restore thiếu nhóm → không đụng file của nhóm đó, giữ bản ghi để restore sau", () => {
    const s = setup();
    exportToGame({ projDir: s.projDir, groups: [s.data, s.csv] });
    // Chỉ truyền nhóm csv/ (không có prefix "" nên data/ không bị khớp nhầm)
    restoreGame({ projDir: s.projDir, groups: [s.csv] });
    expect(readFileSync(join(s.data.gameDir, "Map001.json"), "utf8")).toBe("VI");
    restoreGame({ projDir: s.projDir, groups: [s.data, s.csv] });
    expect(readFileSync(join(s.data.gameDir, "Map001.json"), "utf8")).toBe("EN");
  });

  test("nhóm bắt buộc có bản gốc: thiếu bản gốc → không chép", () => {
    const s = setup();
    writeFileSync(join(s.csv.outDir, "new.csv"), "VI");
    const res = exportToGame({ projDir: s.projDir, groups: [s.csv] });
    expect(res.find(r => r.name === "csv/new.csv")?.status).toBe("missing-source");
    expect(existsSync(join(s.csv.gameDir, "new.csv"))).toBe(false);
  });
});
