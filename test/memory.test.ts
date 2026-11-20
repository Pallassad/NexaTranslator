import { describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TranslationMemory } from "../src/core/memory";

describe("TranslationMemory (SQLite)", () => {
  test("lưu, đọc, ghi đè", () => {
    const tm = new TranslationMemory(join(mkdtempSync(join(tmpdir(), "tm-")), "memory.db"));
    tm.set("Hello", "Xin chào", "auto", "vi", "google");
    expect(tm.get("Hello", "auto", "vi")).toBe("Xin chào");
    expect(tm.get("Hello", "en", "vi")).toBe("Xin chào"); // khác ngôn ngữ gốc, cùng đích → dùng lại bản cũ
    expect(tm.get("Hello", "auto", "en")).toBeUndefined();
    tm.set("Hello", "Chào", "auto", "vi", "claude");
    expect(tm.get("Hello", "auto", "vi")).toBe("Chào");
    expect(tm.count("auto", "vi")).toBe(1);
  });

  test("tự chuyển dữ liệu từ memory.json cũ", () => {
    const dir = mkdtempSync(join(tmpdir(), "tm-"));
    writeFileSync(join(dir, "memory.json"), JSON.stringify({ "auto>vi": { "Yes": "Có", "No": "Không" } }));
    const tm = new TranslationMemory(join(dir, "memory.db"));
    expect(tm.get("No", "auto", "vi")).toBe("Không");
    expect(existsSync(join(dir, "memory.json"))).toBe(false);
    expect(existsSync(join(dir, "memory.json.imported"))).toBe(true);
  });
});
