import { describe, expect, test } from "vitest";
import type { Entry } from "../src/core/types";
import { GlossaryMatcher, autoKeepNames, mapNamesToSync, mergeGlossaries, isDistinctiveName } from "../src/core/glossary";
import { protect, restore } from "../src/core/protect";
import { buildUnits } from "../src/core/units";
import { isTrivial } from "../src/core/translate";

const g = new GlossaryMatcher({
  keep: ["Tsubomi", "Ted"],
  terms: { "Dark Forest": "Rừng Hắc Ám", "Taxi Driver": "Tài xế taxi", Strength: "Thể lực" },
});

describe("GlossaryMatcher + protect", () => {
  test("tên giữ nguyên và thuật ngữ được thay bằng placeholder", () => {
    const p = protect("Tsubomi and Ted went to the Dark Forest.", g);
    expect(p.text).toBe("{0} and {1} went to the {2}.");
    // Dịch xong: placeholder → tên gốc / bản dịch cố định
    expect(restore("{0} và {1} đi tới {2}.", p.tokens)).toEqual({ ok: true, text: "Tsubomi và Ted đi tới Rừng Hắc Ám." });
  });

  test("chỉ khớp nguyên từ với chữ Latin", () => {
    expect(protect("Tedious work", g).text).toBe("Tedious work");
  });

  test("mã màu và thuật ngữ cùng lúc", () => {
    const p = protect("\\C[2]Ted\\C[0] enters Dark Forest", g);
    expect(p.text).toBe("{0}{2}{1} enters {3}");
    expect(restore("{0}{2}{1} vào {3}", p.tokens)).toEqual({ ok: true, text: "\\C[2]Ted\\C[0] vào Rừng Hắc Ám" });
  });

  test("đổi tên trong khung tên \\n<...>", () => {
    expect(g.applyNameCodes("\\n<Taxi Driver>「Where to?」")).toBe("\\n<Tài xế taxi>「Where to?」");
    expect(g.applyNameCodes("\\n<Kent>Hi")).toBe("\\n<Kent>Hi");
  });
});

describe("buildUnits với glossary", () => {
  const d = (ci: number, source: string): Entry => ({
    file: "Map001.json", kind: "dialogue", source, path: ["events", 1, "pages", 0, "list", ci, "parameters", 0],
  });

  test("dòng thoại có khung tên: tên chung được đổi, thoại được dịch", () => {
    const es = [d(1, "\\n<Taxi Driver>Where to, Ted?")];
    const [u] = buildUnits(es, { maxChars: 50, glossary: g });
    expect(u.segments[0].text).toBe("Where to, {0}?");
    u.assemble(["Đi đâu đây, {0}?"]);
    expect(es[0].target).toBe("\\n<Tài xế taxi>Đi đâu đây, Ted?");
  });

  test("không ngắt dòng giữa thuật ngữ nhiều chữ", () => {
    const es = [d(1, "Go to the Dark Forest now, Ted.")];
    const [u] = buildUnits(es, { maxChars: 20, glossary: g });
    u.assemble(["Hãy đi tới {0} ngay, {1}."]);
    expect(es[0].target!.split("\n")).toEqual(["Hãy đi tới", "Rừng Hắc Ám ngay,", "Ted."]);
  });

  test("cả chuỗi là thuật ngữ → câu chỉ còn placeholder → không cần gửi đi dịch", () => {
    const e: Entry = { file: "System.json", path: ["terms", "params", 2], kind: "term", source: "Strength" };
    const [u] = buildUnits([e], { maxChars: 50, glossary: g });
    expect(u.segments[0].text).toBe("{0}");
    expect(isTrivial(u.segments[0].text)).toBe(true);
    u.assemble([u.segments[0].text]);
    expect(e.target).toBe("Thể lực");
  });

  test("tên người nói (101): giữ nguyên, trừ khi glossary có thuật ngữ", () => {
    const s1: Entry = { file: "Map001.json", path: [1], kind: "speaker", source: "Tsubomi" };
    const s2: Entry = { file: "Map001.json", path: [2], kind: "speaker", source: "Taxi Driver" };
    for (const u of buildUnits([s1, s2], { maxChars: 50, glossary: g })) u.assemble([]);
    expect([s1.target, s2.target]).toEqual(["Tsubomi", "Tài xế taxi"]);
  });
});

describe("tự động tạo glossary", () => {
  test("tên nhân vật chỉ lấy từ Actors; bỏ tên quá ngắn, rỗng, undefined, mã", () => {
    expect(autoKeepNames([null, { name: "Tsubomi" }, { name: "Al" }, { name: "健一" }, { name: "" }, { name: "undefined" }, { name: "\\N[1]" }]))
      .toEqual(["Tsubomi", "健一"]);
  });

  test("tên khu vực đủ đặc trưng và có trong thoại mới được đồng bộ", () => {
    expect(isDistinctiveName("Dark Forest")).toBe(true);
    expect(isDistinctiveName("Home")).toBe(false);
    expect(isDistinctiveName("the shop")).toBe(false);
    expect(isDistinctiveName("暗黒の森")).toBe(true);
    const es: Entry[] = [
      { file: "Map002.json", path: ["displayName"], kind: "mapName", source: "Dark Forest" },
      { file: "Map003.json", path: ["displayName"], kind: "mapName", source: "Old Mine" },
      { file: "Map001.json", path: [1], kind: "dialogue", source: "Go to the Dark Forest." },
    ];
    expect(mapNamesToSync(es, new Set()).map(e => e.source)).toEqual(["Dark Forest"]);
  });

  test("gộp glossary: thuật ngữ của người dùng ghi đè danh sách giữ nguyên", () => {
    const m = mergeGlossaries({ keep: ["Ted", "Young Woman"], terms: {} }, { keep: [], terms: { "Young Woman": "Thiếu nữ" } });
    expect(m).toEqual({ keep: ["Ted"], terms: { "Young Woman": "Thiếu nữ" } });
  });
});
