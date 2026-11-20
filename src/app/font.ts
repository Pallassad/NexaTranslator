import { join, basename } from "node:path";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { readJson, writeJson } from "../core/writer";
import {
  bundledFont, bundledLicense, VIETNAMESE_CHARS, applyFontChoice, charsInTexts, detectGameFont,
  loadFontChoice, missingGlyphs, saveFontChoice, type GameFontInfo,
} from "../formats/rpgm/fonts";
import type { RpgmGame } from "../formats/rpgm/game";
import type { DetectedFormat } from "../formats/types";
import type { GameSession } from "./session";

/** Font Doctor chỉ dùng cho game RPG Maker MV/MZ. */
function requireRpgm(session: GameSession): { rpgmData: DetectedFormat; rpgm: RpgmGame } {
  const { rpgmData, rpgm } = session;
  if (!rpgmData || !rpgm) throw new Error("Font Doctor chỉ dùng cho game RPG Maker MV/MZ.");
  return { rpgmData, rpgm };
}

export interface FontCheck {
  engine: "MV" | "MZ";
  info: GameFontInfo;
  /** Kết quả kiểm tra font chính; undefined = không tìm thấy file font (game dùng font hệ thống). */
  main?: { family: string; missing: string[] };
  /** Số ký tự đã kiểm tra (bảng chữ tiếng Việt + chữ trong bản dịch). */
  checkedChars: number;
  /** Font thay thế đang chọn (nếu có). */
  choice?: string;
  /** Đã có bản dịch trong output chưa. */
  hasTranslation: boolean;
}

/** Kiểm tra font của game có đủ chữ tiếng Việt không. */
export function fontCheck(session: GameSession): FontCheck {
  const { rpgmData, rpgm } = requireRpgm(session);
  const src = session.sourceDirOf(rpgmData);
  const system = readJson(join(src, "System.json"));
  const info = detectGameFont(rpgm.dataDir, rpgm.engine, system);
  const translated = session.translatedTexts();
  const chars = [...new Set([...VIETNAMESE_CHARS, ...charsInTexts(translated)])];
  const main = info.mainPath && existsSync(info.mainPath) ? missingGlyphs(info.mainPath, chars) : undefined;
  return {
    engine: rpgm.engine, info, main, checkedChars: chars.length,
    choice: loadFontChoice(session.paths.projDir)?.file,
    hasTranslation: translated.length > 0,
  };
}

/** Chọn font thay thế (mặc định font Be Vietnam Pro kèm tool) và áp vào bản xuất. */
export function fontFix(session: GameSession, fontPath?: string): { family: string; file: string } {
  const { rpgmData, rpgm } = requireRpgm(session);
  const src = session.sourceDirOf(rpgmData);
  const fontSrc = fontPath || bundledFont();
  if (!existsSync(fontSrc)) throw new Error(`Không tìm thấy file font: ${fontSrc}`);
  const check = missingGlyphs(fontSrc, VIETNAMESE_CHARS);
  if (check.missing.length) {
    throw new Error(`Font ${check.family} cũng thiếu ${check.missing.length} chữ tiếng Việt (${check.missing.slice(0, 10).join(" ")}) → chọn font khác.`);
  }
  const choice = {
    source: fontSrc, file: basename(fontSrc),
    license: fontSrc === bundledFont() ? bundledLicense() : undefined,
  };
  const { outDir, projDir } = session.paths;
  saveFontChoice(projDir, choice);
  applyFontChoice({ choice, engine: rpgm.engine, outDir, projDir, sourceDir: src, gameDataDir: rpgm.dataDir });
  return { family: check.family, file: choice.file };
}

/** Bỏ font thay thế – game dùng lại font gốc. */
export function fontReset(session: GameSession): void {
  const { rpgmData, rpgm } = requireRpgm(session);
  const src = session.sourceDirOf(rpgmData);
  const system = readJson(join(src, "System.json"));
  const { outDir, projDir } = session.paths;
  rmSync(join(projDir, "font.json"), { force: true });
  rmSync(join(outDir, "fonts"), { recursive: true, force: true });
  const outSystem = join(outDir, "data", "System.json");
  if (rpgm.engine === "MZ" && existsSync(outSystem)) {
    const sys = readJson(outSystem);
    sys.advanced = { ...(sys.advanced ?? {}), mainFontFilename: system.advanced?.mainFontFilename };
    writeJson(outSystem, sys);
  }
  if (rpgm.engine === "MV" && existsSync(join(projDir, "source-fonts", "gamefont.css"))) {
    mkdirSync(join(outDir, "fonts"), { recursive: true });
    copyFileSync(join(projDir, "source-fonts", "gamefont.css"), join(outDir, "fonts", "gamefont.css"));
  }
}
