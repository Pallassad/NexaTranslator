import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { assetsDir } from "../../core/assets";
import * as fontkit from "fontkit";
import { readJson, writeJson } from "../../core/writer";
import type { Engine } from "./game";

/**
 * Font Doctor: kiểm tra font của game có đủ chữ tiếng Việt không, và đổi font khi cần.
 *
 *  - MZ: font chính khai báo trong data/System.json → advanced.mainFontFilename (file nằm trong fonts/)
 *  - MV: font chính khai báo trong fonts/gamefont.css (@font-face GameFont)
 *  Font số (MZ numberFontFilename) chỉ dùng vẽ chữ số → không kiểm tra.
 */

export { assetsDir };

/** Font tiếng Việt kèm theo tool (giấy phép SIL OFL – được phép kèm vào game). */
export const bundledFont = () => join(assetsDir(), "fonts", "BeVietnamPro-Regular.ttf");
export const bundledLicense = () => join(assetsDir(), "fonts", "BeVietnamPro-OFL.txt");

/** Toàn bộ chữ cái tiếng Việt có dấu (thường + hoa). */
export const VIETNAMESE_CHARS = (() => {
  const lower = "àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ";
  return [...new Set([...lower, ...lower.toUpperCase()])];
})();

export interface GameFontInfo {
  engine: Engine;
  /** Tên file font chính (trong thư mục fonts/). */
  mainFile: string | null;
  mainPath: string | null;
  /** MV: đường dẫn gamefont.css. */
  cssPath?: string;
  /** Plugin tự đặt font riêng (Font Doctor không đổi được). */
  pluginFonts: { plugin: string; file: string }[];
}

/** Thư mục gốc của game chứa data/, fonts/, js/ (MV: thư mục www). */
export const gameBase = (dataDir: string) => dirname(dataDir);

/** Đọc font MV từ gamefont.css: url("mplus-1m-regular.ttf"). */
function cssFontFile(css: string): string | null {
  return css.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1] ?? null;
}

export function detectGameFont(dataDir: string, engine: Engine, systemJson: any): GameFontInfo {
  const base = gameBase(dataDir);
  const fontsDir = join(base, "fonts");
  let mainFile: string | null = null;
  let cssPath: string | undefined;

  if (engine === "MZ") {
    mainFile = systemJson?.advanced?.mainFontFilename || null;
  } else {
    cssPath = join(fontsDir, "gamefont.css");
    if (existsSync(cssPath)) mainFile = cssFontFile(readFileSync(cssPath, "utf8"));
  }
  const mainPath = mainFile ? join(fontsDir, mainFile) : null;

  // Plugin có tham số trỏ tới file font → có thể ghi đè font của game
  const pluginFonts: GameFontInfo["pluginFonts"] = [];
  const pluginsJs = join(base, "js", "plugins.js");
  if (existsSync(pluginsJs)) {
    const text = readFileSync(pluginsJs, "utf8");
    try {
      const plugins = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as any[];
      for (const p of plugins) {
        if (!p?.status) continue;
        const found = JSON.stringify(p.parameters ?? {}).match(/[\w\- .]+\.(ttf|otf|woff2?)/gi) ?? [];
        for (const f of new Set(found)) pluginFonts.push({ plugin: p.name, file: f.trim() });
      }
    } catch { /* plugins.js lạ → bỏ qua */ }
  }
  return { engine, mainFile, mainPath, cssPath, pluginFonts };
}

/** Các ký tự font KHÔNG có. */
export function missingGlyphs(fontPath: string, chars: Iterable<string>): { family: string; missing: string[] } {
  const opened: any = fontkit.openSync(fontPath);
  const font = "fonts" in opened ? opened.fonts[0] : opened; // file .ttc chứa nhiều font
  const missing = [...new Set(chars)].filter(c => !font.hasGlyphForCodePoint(c.codePointAt(0)!));
  return { family: font.familyName ?? basename(fontPath), missing };
}

/** Ký tự không phải ASCII xuất hiện trong bản dịch (để kiểm tra font). */
export function charsInTexts(texts: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const t of texts) for (const c of t) if (c.codePointAt(0)! > 0x7e && /\p{L}/u.test(c)) set.add(c);
  return [...set];
}

// ---------------------------------------------------------------------------
// Đổi font: lựa chọn được lưu ở projects/<game>/font.json và áp vào output mỗi lần dịch
// ---------------------------------------------------------------------------

export interface FontChoice {
  /** Đường dẫn file font nguồn (font kèm tool hoặc font người dùng chọn). */
  source: string;
  /** Tên file khi chép vào thư mục fonts/ của game. */
  file: string;
  /** File giấy phép đi kèm (nếu có). */
  license?: string;
}

export const loadFontChoice = (projDir: string): FontChoice | null =>
  existsSync(join(projDir, "font.json")) ? (readJson(join(projDir, "font.json")) as FontChoice) : null;

export function saveFontChoice(projDir: string, choice: FontChoice) {
  writeJson(join(projDir, "font.json"), choice, true);
}

/**
 * Áp font đã chọn vào thư mục output:
 *  - chép file font (+ giấy phép) vào output/<game>/fonts/
 *  - MZ: sửa advanced.mainFontFilename trong output/<game>/data/System.json
 *  - MV: tạo output/<game>/fonts/gamefont.css trỏ tới font mới
 * Bản gốc của file sẽ bị thay (gamefont.css) được chép vào projects/<game>/source-fonts/ để khôi phục.
 */
export function applyFontChoice(opt: {
  choice: FontChoice; engine: Engine; outDir: string; projDir: string; sourceDir: string; gameDataDir: string;
}) {
  const { choice, engine, outDir, projDir, sourceDir, gameDataDir } = opt;
  const outFonts = join(outDir, "fonts");
  mkdirSync(outFonts, { recursive: true });
  copyFileSync(choice.source, join(outFonts, choice.file));
  if (choice.license && existsSync(choice.license)) copyFileSync(choice.license, join(outFonts, basename(choice.license)));

  if (engine === "MZ") {
    const outSystem = join(outDir, "data", "System.json");
    const sys = readJson(existsSync(outSystem) ? outSystem : join(sourceDir, "System.json"));
    sys.advanced = { ...(sys.advanced ?? {}), mainFontFilename: choice.file };
    writeJson(outSystem, sys);
  } else {
    const gameCss = join(gameBase(gameDataDir), "fonts", "gamefont.css");
    const srcFonts = join(projDir, "source-fonts");
    const savedCss = join(srcFonts, "gamefont.css");
    if (!existsSync(savedCss) && existsSync(gameCss)) {
      mkdirSync(srcFonts, { recursive: true });
      copyFileSync(gameCss, savedCss);
    }
    const original = existsSync(savedCss) ? readFileSync(savedCss, "utf8")
      : `@font-face {\n    font-family: GameFont;\n    src: url("mplus-1m-regular.ttf");\n}\n`;
    writeFileSync(join(outFonts, "gamefont.css"),
      original.replace(/url\(\s*["']?[^"')]+["']?\s*\)/, `url("${choice.file}")`), "utf8");
  }
}
