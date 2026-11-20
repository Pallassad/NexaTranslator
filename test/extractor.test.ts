import { describe, expect, test } from "vitest";
import { extractFile } from "../src/formats/rpgm-data/extractor";
import { applyEntries } from "../src/core/writer";

const map = {
  displayName: "Dark Forest",
  events: [
    null,
    {
      pages: [{
        list: [
          { code: 101, parameters: ["", 0, 0, 2, "Alice"] },     // tên người nói → không lấy
          { code: 401, parameters: ["\\C[2]Hello\\C[0], \\N[1]!"] },
          { code: 102, parameters: [["Yes", "No"], 1, 0, 2, 0] },
          { code: 355, parameters: ["$gameScreen.clearPictures();"] }, // script → không lấy
          { code: 401, parameters: [""] },                           // dòng rỗng → bỏ
          { code: 0, parameters: [] },
        ],
      }],
    },
  ],
};

describe("extractFile", () => {
  test("Map: lấy displayName, 401, 102, tên người nói (speaker); bỏ 355, dòng rỗng", () => {
    const e = extractFile("Map001.json", "story", map);
    expect(e.map(x => [x.kind, x.source])).toEqual([
      ["mapName", "Dark Forest"],
      ["speaker", "Alice"],
      ["dialogue", "\\C[2]Hello\\C[0], \\N[1]!"],
      ["choice", "Yes"],
      ["choice", "No"],
    ]);
  });

  test("Actors: tên là kiểu speaker (không dịch máy), biệt danh + tiểu sử dịch bình thường", () => {
    const e = extractFile("Actors.json", "actors", [null, { name: "佐藤", nickname: "剣士", profile: "村の少女" }]);
    expect(e.map(x => [x.kind, x.source])).toEqual([["speaker", "佐藤"], ["name", "剣士"], ["description", "村の少女"]]);
  });

  test("Skills: lấy cả message, giữ nguyên dấu cách đầu chuỗi", () => {
    const e = extractFile("Skills.json", "skills", [null, { name: "Fire", description: "", message1: " casts %1!" }]);
    expect(e.map(x => x.source)).toEqual(["Fire", " casts %1!"]);
  });
});

describe("applyEntries", () => {
  test("khứ hồi: ghi lại text gốc → không thay đổi gì", () => {
    const copy = structuredClone(map);
    applyEntries(copy, extractFile("Map001.json", "story", copy));
    expect(copy).toEqual(map);
  });

  test("chỉ sửa đúng vị trí đã dịch", () => {
    const copy = structuredClone(map);
    const e = extractFile("Map001.json", "story", copy);
    e[0].target = "Rừng Hắc Ám";
    applyEntries(copy, e);
    expect(copy.displayName).toBe("Rừng Hắc Ám");
    expect(copy.events[1]!.pages[0].list[0].parameters[4]).toBe("Alice"); // tên người nói giữ nguyên
  });

  test("báo lỗi nếu đường dẫn không còn đúng", () => {
    expect(() => applyEntries({}, [{ file: "x", path: ["a", "b"], kind: "name", source: "x" }]))
      .toThrow(/không tồn tại/);
  });
});
