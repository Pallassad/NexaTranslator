import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readJson, writeJson, applyEntries } from "../../core/writer";
import { autoKeepNames } from "../../core/glossary";
import { findRpgm } from "../rpgm/game";
import type { DetectedFormat, FormatAdapter, GamePaths } from "../types";
import { NO_TEXT_GROUPS, classify, detectGame } from "./scanner";
import { extractFile } from "./extractor";
import { ensureSourceSnapshot } from "./snapshot";

/**
 * Bộ đọc RPG Maker MV/MZ – thư mục data/*.json
 * (thoại 401/102/405, tên khu vực, vật phẩm, kỹ năng, System...).
 */
export const rpgmData: FormatAdapter = {
  id: "rpgm-data",
  label: "RPG Maker – Data (data/*.json)",

  detect(root): DetectedFormat | null {
    const rpgm = findRpgm(root);
    if (!rpgm) return null;
    const game = detectGame(root);
    const sourceDir = (p: GamePaths) => join(p.projDir, "source");

    return {
      id: this.id,
      label: this.label,
      priority: 10,
      info: [`Engine: ${rpgm.engine}`, `Thư mục data: ${rpgm.dataDir}`],
      files: game.files.map(f => ({ name: f.name, group: f.group, hasText: !NO_TEXT_GROUPS.has(f.group) })),
      outSubdir: "data",
      rpgm,
      sourceDir,

      snapshot: (p, refresh) => ensureSourceSnapshot(rpgm.dataDir, sourceDir(p), refresh),

      load(dir, name) {
        const data = readJson(join(dir, name));
        const entries = extractFile(name, classify(name), data);
        return {
          name,
          entries,
          write: (outPath, list) => writeJson(outPath, applyEntries(structuredClone(data), list)),
          roundtripOk: () => isDeepStrictEqual(applyEntries(structuredClone(data), entries), data),
        };
      },

      exportGroups: p => [{
        prefix: "", outDir: join(p.outDir, "data"), gameDir: rpgm.dataDir, sourceDir: sourceDir(p),
        filter: n => n.toLowerCase().endsWith(".json"), requireSource: true,
      }],

      actorNames(dir) {
        try {
          const rows = readJson(join(dir, "Actors.json")) as ({ name?: unknown } | null)[];
          return rows.flatMap((a, id) => (a && typeof a.name === "string" && a.name.trim() ? [{ id, name: a.name.trim() }] : []));
        } catch { return []; }
      },

      keepNames(dir) {
        try { return autoKeepNames(readJson(join(dir, "Actors.json"))); }
        catch { return []; } // game không có Actors.json
      },
    };
  },
};
