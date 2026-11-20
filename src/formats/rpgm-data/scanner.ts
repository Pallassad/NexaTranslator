import { readdirSync } from "node:fs";
import { findRpgm, rpgmNotFound, type Engine } from "../rpgm/game";

export type { Engine };
export type Group =
  | "story" | "items" | "skills" | "system"
  | "enemies" | "classes" | "actors" | "skip" | "other";

export interface DataFile { name: string; group: Group; }
export interface GameInfo { root: string; engine: Engine; dataDir: string; files: DataFile[]; }

const GROUPS: Record<string, Group> = {
  "CommonEvents.json": "story", "Troops.json": "story",
  "Items.json": "items", "Weapons.json": "items", "Armors.json": "items",
  "Skills.json": "skills", "States.json": "skills",
  "System.json": "system",
  "Enemies.json": "enemies",
  "Classes.json": "classes",
  "Actors.json": "actors",
  // Không chứa chữ hiển thị → bỏ qua
  "MapInfos.json": "skip", "Animations.json": "skip", "Tilesets.json": "skip",
};

/** Nhóm không có chữ cần dịch. */
export const NO_TEXT_GROUPS = new Set<Group>(["skip", "other"]);

export function classify(name: string): Group {
  if (/^Map\d{3}\.json$/i.test(name)) return "story";
  return GROUPS[name] ?? "other";
}

export function detectGame(root: string): GameInfo {
  const g = findRpgm(root);
  if (!g) throw rpgmNotFound(root);
  const files = readdirSync(g.dataDir)
    .filter(f => f.toLowerCase().endsWith(".json"))
    .map(name => ({ name, group: classify(name) }));
  return { root, engine: g.engine, dataDir: g.dataDir, files };
}
