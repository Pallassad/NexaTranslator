import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, detectGame } from "../src/formats/rpgm-data/scanner";

function fakeGame(layout: "MV" | "MZ") {
  const root = mkdtempSync(join(tmpdir(), "rpgm-"));
  const base = layout === "MV" ? join(root, "www") : root;
  mkdirSync(join(base, "data"), { recursive: true });
  mkdirSync(join(base, "js"), { recursive: true });
  writeFileSync(join(base, "data", "System.json"), "{}");
  writeFileSync(join(base, "data", "Map001.json"), "{}");
  writeFileSync(join(base, "js", layout === "MV" ? "rpg_core.js" : "rmmz_core.js"), "");
  return root;
}

describe("classify", () => {
  test("phân nhóm đúng", () => {
    expect(classify("Map001.json")).toBe("story");
    expect(classify("Items.json")).toBe("items");
    expect(classify("Actors.json")).toBe("actors");
    expect(classify("MapInfos.json")).toBe("skip");
    expect(classify("QuestData.json")).toBe("other");
  });
});

describe("detectGame", () => {
  test("nhận diện MZ", () => {
    const g = detectGame(fakeGame("MZ"));
    expect(g.engine).toBe("MZ");
    expect(g.files.map(f => f.name)).toContain("Map001.json");
  });

  test("nhận diện MV (có thư mục www)", () => {
    expect(detectGame(fakeGame("MV")).engine).toBe("MV");
  });

  test("báo lỗi khi không phải game RPGM", () => {
    const empty = mkdtempSync(join(tmpdir(), "rpgm-"));
    expect(() => detectGame(empty)).toThrow(/Không tìm thấy/);
  });
});
