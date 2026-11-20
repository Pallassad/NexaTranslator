import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig, saveConfig } from "../src/core/config";
import { TranslationMemory } from "../src/core/memory";

describe("ghi cài đặt", () => {
  test("chỉ đổi mục được gửi, giữ nguyên các mục khác trong config.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "nexa-cfg-"));
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({ engines: ["google"], paidEngine: "claude", from: "auto", to: "vi", pricing: { x: { input: 1, output: 2 } }, delayMs: 700 }));
    const c = saveConfig(p, { paidEngine: "claude-sonnet", maxCost: 2.5 });
    expect(c).toMatchObject({ paidEngine: "claude-sonnet", maxCost: 2.5, from: "auto", delayMs: 700 });
    const raw = JSON.parse(readFileSync(p, "utf8"));
    expect(raw.pricing).toEqual({ x: { input: 1, output: 2 } });
    expect(saveConfig(p, { maxCost: null, from: "ja" })).toMatchObject({ maxCost: 0, from: "ja", paidEngine: "claude-sonnet" });
  });

  test("chưa có config.json → mặc định giới hạn $1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nexa-cfg-"));
    expect(loadConfig(join(dir, "config.json"), "").maxCost).toBe(1);
  });
});

describe("memory khi đổi ngôn ngữ gốc", () => {
  test("bản dịch cũ (auto>vi) vẫn dùng được khi chuyển sang ja>vi", () => {
    const tm = new TranslationMemory(join(mkdtempSync(join(tmpdir(), "nexa-tm-")), "memory.db"));
    tm.set("こんにちは", "Xin chào", "auto", "vi");
    expect(tm.get("こんにちは", "ja", "vi")).toBe("Xin chào");
    expect(tm.get("こんにちは", "ja", "en")).toBeUndefined(); // khác ngôn ngữ đích → không dùng
    tm.set("こんにちは", "Chào bạn", "ja", "vi");
    expect(tm.get("こんにちは", "ja", "vi")).toBe("Chào bạn"); // đúng cặp được ưu tiên
    tm.close();
  });
});
