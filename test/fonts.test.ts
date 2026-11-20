import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bundledFont, VIETNAMESE_CHARS, missingGlyphs, detectGameFont, applyFontChoice, charsInTexts,
} from "../src/formats/rpgm/fonts";

describe("kiểm tra chữ trong font", () => {
  test("font kèm theo tool (Be Vietnam Pro) đủ toàn bộ chữ tiếng Việt", () => {
    const r = missingGlyphs(bundledFont(), VIETNAMESE_CHARS);
    expect(r.family).toBe("Be Vietnam Pro");
    expect(r.missing).toEqual([]);
  });

  test("font chỉ có chữ số (font số của MZ) thiếu chữ tiếng Việt", () => {
    const r = missingGlyphs(join(__dirname, "fixtures", "mplus-2p-bold-sub.woff"), ["ế", "ộ", "1"]);
    expect(r.missing).toEqual(["ế", "ộ"]);
  });

  test("lấy ký tự cần kiểm tra từ bản dịch (bỏ ASCII)", () => {
    expect(charsInTexts(["Xin chào", "Tiếng Việt!"]).sort()).toEqual(["à", "ế", "ệ"].sort());
  });
});

function fakeGame(engine: "MV" | "MZ") {
  const root = mkdtempSync(join(tmpdir(), "font-"));
  const base = engine === "MV" ? join(root, "www") : root;
  for (const d of ["data", "fonts", "js"]) mkdirSync(join(base, d), { recursive: true });
  const system = { advanced: { mainFontFilename: "game.woff", numberFontFilename: "num.woff" }, terms: {} };
  writeFileSync(join(base, "data", "System.json"), JSON.stringify(system));
  if (engine === "MV") writeFileSync(join(base, "fonts", "gamefont.css"), '@font-face {\n  font-family: GameFont;\n  src: url("mplus-1m-regular.ttf");\n}\n');
  writeFileSync(join(base, "js", "plugins.js"),
    'var $plugins =\n[{"name":"VisuMZ_1_MessageCore","status":true,"description":"","parameters":{"Font":"CustomFont.ttf"}}];\n');
  return { root, dataDir: join(base, "data"), base, system };
}

describe("phát hiện font của game", () => {
  test("MZ: lấy từ System.json, phát hiện plugin dùng font riêng", () => {
    const g = fakeGame("MZ");
    const info = detectGameFont(g.dataDir, "MZ", g.system);
    expect(info.mainFile).toBe("game.woff");
    expect(info.pluginFonts).toEqual([{ plugin: "VisuMZ_1_MessageCore", file: "CustomFont.ttf" }]);
  });

  test("MV: lấy từ gamefont.css", () => {
    const g = fakeGame("MV");
    expect(detectGameFont(g.dataDir, "MV", g.system).mainFile).toBe("mplus-1m-regular.ttf");
  });
});

describe("đổi font", () => {
  const choice = { source: bundledFont(), file: "BeVietnamPro-Regular.ttf" };

  test("MZ: chép font vào output/fonts và sửa mainFontFilename trong System.json", () => {
    const g = fakeGame("MZ");
    const out = join(g.root, "out"), proj = join(g.root, "proj");
    applyFontChoice({ choice, engine: "MZ", outDir: out, projDir: proj, sourceDir: g.dataDir, gameDataDir: g.dataDir });
    const sys = JSON.parse(readFileSync(join(out, "data", "System.json"), "utf8"));
    expect(sys.advanced).toEqual({ mainFontFilename: "BeVietnamPro-Regular.ttf", numberFontFilename: "num.woff" });
    expect(readFileSync(join(out, "fonts", "BeVietnamPro-Regular.ttf")).length).toBeGreaterThan(1000);
  });

  test("MV: tạo gamefont.css mới, lưu bản gốc để khôi phục", () => {
    const g = fakeGame("MV");
    const out = join(g.root, "out"), proj = join(g.root, "proj");
    applyFontChoice({ choice, engine: "MV", outDir: out, projDir: proj, sourceDir: g.dataDir, gameDataDir: g.dataDir });
    expect(readFileSync(join(out, "fonts", "gamefont.css"), "utf8")).toContain('url("BeVietnamPro-Regular.ttf")');
    expect(readFileSync(join(proj, "source-fonts", "gamefont.css"), "utf8")).toContain("mplus-1m-regular.ttf");
  });
});
