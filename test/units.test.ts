import { describe, expect, test } from "vitest";
import type { Entry } from "../src/core/types";
import { buildUnits } from "../src/core/units";

const d = (ci: number, source: string, list = "events.1.pages.0.list"): Entry => ({
  file: "Map001.json", kind: "dialogue", source,
  path: [...list.split(".").map(x => (/^\d+$/.test(x) ? Number(x) : x)), ci, "parameters", 0],
});

describe("buildUnits", () => {
  test("gộp các dòng 401 liên tiếp thành 1 câu", () => {
    const units = buildUnits([
      d(5, "Ted is an international student from the United States"),
      d(6, "and was a boy who always came at the promised time."),
      d(9, "New message."), // không liên tiếp → khối mới
    ], { maxChars: 50 });
    expect(units).toHaveLength(2);
    expect(units[0].segments[0].text).toBe(
      "Ted is an international student from the United States and was a boy who always came at the promised time.");
  });

  test("chia lại dòng và gắn lại mã căn giữa cho mọi dòng", () => {
    const es = [d(1, "<center>After a heavy, hesitant pause,"), d(2, "<center>Her subordinates retreat.")];
    const [u] = buildUnits(es, { maxChars: 20 });
    expect(u.segments[0].text).toBe("After a heavy, hesitant pause, Her subordinates retreat.");
    expect(u.assemble(["Sau một khoảng lặng nặng nề, cấp dưới của cô rút lui."])).toBeNull();
    // 2 lệnh 401 sẵn có: dòng 1 vào lệnh 1, phần còn lại dồn vào lệnh cuối bằng \n
    expect(es[0].target).toBe("<center>Sau một khoảng lặng");
    expect(es[1].target!.split("\n").every(l => l.startsWith("<center>"))).toBe(true);
  });

  test("bản dịch ngắn hơn → lệnh thừa để trống", () => {
    const es = [d(1, "Hello there,"), d(2, "my friend.")];
    const [u] = buildUnits(es, { maxChars: 40 });
    u.assemble(["Chào bạn."]);
    expect(es.map(e => e.target)).toEqual(["Chào bạn.", ""]);
  });

  test("lỗi placeholder → trả lý do, không gán target", () => {
    const es = [d(1, "Hi \\N[1]!")];
    const [u] = buildUnits(es, { maxChars: 40 });
    expect(u.assemble(["Chào!"])).toMatch(/mất/);
    expect(es[0].target).toBeUndefined();
  });

  test("mô tả 2 dòng (\\n) → giữ nguyên 2 dòng", () => {
    const e: Entry = { file: "Items.json", path: [1, "description"], kind: "description", source: "Heals 50 HP.\nCan be used in battle." };
    const [u] = buildUnits([e], { maxChars: 40 });
    expect(u.segments.map(s => s.text)).toEqual(["Heals 50 HP.", "Can be used in battle."]);
    u.assemble(["Hồi 50 HP.", "Dùng được trong trận."]);
    expect(e.target).toBe("Hồi 50 HP.\nDùng được trong trận.");
  });
});
