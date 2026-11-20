import { describe, expect, test } from "vitest";
import {
  cleanReading, detectNameLang, isKanaOnly, kanaToRomaji, suggestNames, toHanViet,
} from "../src/core/names";
import { parseReading } from "../src/core/providers/google";
import { GlossaryMatcher, actorGlossary, mergeGlossaries } from "../src/core/glossary";
import { buildUnits } from "../src/core/units";
import type { Entry } from "../src/core/types";

describe("kana → Romaji (kiểu Sato)", () => {
  test.each([
    ["さとう", "Sato"], ["ゆうき", "Yuki"], ["おおの", "Ono"], ["けいこ", "Keiko"], ["ひかり", "Hikari"],
    ["しょうた", "Shota"], ["きょうこ", "Kyoko"], ["まっち", "Matchi"], ["けんた", "Kenta"], ["じゅん", "Jun"],
    ["リュウ", "Ryu"], ["ジョー", "Jo"], ["アリス・マーガトロイド", "Arisu Magatoroido"], ["ティナ", "Tina"],
    ["ファイ", "Fai"], ["ヴィクトリア", "Vikutoria"], ["さくら　はるの", "Sakura Haruno"], ["サッカ", "Sakka"],
  ])("%s → %s", (k, r) => expect(kanaToRomaji(k)).toBe(r));

  test("nhận ra tên chỉ có kana", () => {
    expect(isKanaOnly("さとう")).toBe(true);
    expect(isKanaOnly("アリス・C")).toBe(false);
    expect(isKanaOnly("佐藤")).toBe(false);
  });
});

describe("Hán Việt", () => {
  test.each([["李白", "Lý Bạch"], ["王龙", "Vương Long"], ["诸葛亮", "Chư Cát Lượng"], ["林黛玉", "Lâm Đại Ngọc"],
    ["張偉", "Trương Vĩ"], ["小雪", "Tiểu Tuyết"]])("%s → %s", (k, r) => expect(toHanViet(k).text).toBe(r));

  test("chữ không có trong từ điển → giữ nguyên + báo", () => {
    const r = toHanViet("李ㄅ");
    expect(r.text.startsWith("Lý")).toBe(true);
  });
});

describe("cách đọc Google", () => {
  test("đọc phần phiên âm gốc trong phản hồi dt=rm", () => {
    const data = [[["Sato", "佐藤", null, null, 10], [null, null, null, "Satō"]], null, "ja"];
    expect(parseReading(data)).toBe("Satō");
    expect(parseReading([[["Hello", "Hello"]]])).toBeUndefined();
    expect(parseReading(null)).toBeUndefined();
  });

  test("làm sạch: bỏ trường âm, viết hoa đầu từ", () => {
    expect(cleanReading("Satō")).toBe("Sato");
    expect(cleanReading("suzuki hanako")).toBe("Suzuki Hanako");
    expect(cleanReading("Ōtsuka Yūko")).toBe("Otsuka Yuko");
  });
});

describe("nhận diện ngôn ngữ cả game", () => {
  test("có kana → Nhật, chỉ chữ Hán → Trung, còn lại Latin", () => {
    expect(detectNameLang(["佐藤さんはどこですか？".repeat(5)])).toBe("ja");
    expect(detectNameLang(["李白在哪里？我们走吧。".repeat(5)])).toBe("zh");
    expect(detectNameLang(["Hello there, traveler."])).toBe("latin");
  });
});

describe("gợi ý tên", () => {
  test("Latin giữ nguyên, kana offline, kanji hỏi Google, Trung → Hán Việt", async () => {
    const asked: string[] = [];
    const reading = async (s: string) => { asked.push(s); return s === "佐藤" ? "Satō" : undefined; };
    const ja = await suggestNames(["Alice", "さとう", "佐藤", "光"], "ja", reading);
    expect(ja.map(x => [x.suggestion, x.method])).toEqual([
      ["Alice", "latin"], ["Sato", "kana"], ["Sato", "google"], ["", "none"],
    ]);
    expect(asked).toEqual(["佐藤", "光"]); // không hỏi Google cho tên Latin / kana
    const zh = await suggestNames(["李白", "Bob"], "zh");
    expect(zh.map(x => x.suggestion)).toEqual(["Lý Bạch", "Bob"]);
  });

  test("Google lỗi → không có gợi ý, báo tự nhập", async () => {
    const r = await suggestNames(["佐藤"], "ja", async () => { throw new Error("HTTP 500"); });
    expect(r[0]).toMatchObject({ suggestion: "", method: "none" });
    expect(r[0].note).toContain("HTTP 500");
  });
});

describe("áp dụng tên đã duyệt", () => {
  test("tên dài thay cả trong thoại; tên 1 chữ chỉ thay khi khớp nguyên chuỗi", () => {
    const g = mergeGlossaries({ keep: ["佐藤"], terms: {} }, actorGlossary({ 佐藤: "Sato", 光: "Hikari", Bob: "Bob" }));
    expect(g.terms).toEqual({ 佐藤: "Sato" });
    expect(g.keep).toEqual([]);
    const m = new GlossaryMatcher(g);
    expect(m.exact("光")).toBe("Hikari");
    expect(m.exact("佐藤")).toBe("Sato");
    expect(m.replace("光が佐藤を照らす", v => `<${v}>`)).toBe("光が<Sato>を照らす");

    // Tên trong Actors.json / tên người nói (kiểu speaker) → đổi theo tên đã duyệt, không cần dịch
    const entries: Entry[] = [
      { file: "Actors.json", path: [1, "name"], kind: "speaker", source: "光" },
      { file: "Actors.json", path: [2, "name"], kind: "speaker", source: "村長" },
    ];
    const units = buildUnits(entries, { maxChars: 40, glossary: m });
    units.forEach(u => u.assemble([]));
    expect(entries.map(e => e.target)).toEqual(["Hikari", "村長"]);
  });
});
