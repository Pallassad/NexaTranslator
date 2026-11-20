import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { columnIndex, parseCsv, replaceCells } from "../src/formats/rpgm-kns-csv/csv";
import { joinCell, splitCell, type Piece } from "../src/formats/rpgm-kns-csv/cells";
import { detectFormats } from "../src/formats/registry";
import { buildUnits } from "../src/core/units";
import { protect, splitAffix } from "../src/core/protect";
import { dropCommonWords } from "../src/core/glossary";
import { extractFile } from "../src/formats/rpgm-data/extractor";

const values = (text: string) => parseCsv(text).rows.map(r => r.map(c => c.value));

describe("CSV (giống hàm CSV của game)", () => {
  test("ngoặc kép, xuống dòng trong ô, \"\" và CRLF", () => {
    const text = 'a,"x\r\ny","say ""hi""",\r\n$text1,b,c\r\n';
    expect(values(text)).toEqual([["a", "x\ny", 'say "hi"', ""], ["$text1", "b", "c"]]);
  });

  test("dòng cuối không có xuống dòng → bị bỏ (game cũng vậy)", () => {
    expect(values("a,b\nc,d")).toEqual([["a", "b"]]);
  });

  test("thay ô: chỉ đổi đúng ô đó, giữ nguyên phần còn lại từng byte", () => {
    const text = 'id,jp,en\r\n1,"日本\r\n語","Old, text"\r\n2,x,y\r\n';
    const doc = parseCsv(text);
    const out = replaceCells(doc, new Map([["1,2", 'Mới "1",\nhai'], ["2,2", "y"]]));
    expect(out).toBe('id,jp,en\r\n1,"日本\r\n語","Mới ""1"",\r\nhai"\r\n2,x,y\r\n');
    expect(values(out)[1][2]).toBe('Mới "1",\nhai');
    expect(replaceCells(doc, new Map())).toBe(text);
  });

  test("tên cột kiểu bảng tính", () => {
    expect([columnIndex("A"), columnIndex("E"), columnIndex("J"), columnIndex("AA")]).toEqual([0, 4, 9, 26]);
  });
});

describe("ô thoại", () => {
  const cell = "\\c[6][Thug A]\\c[0]/\nHeeeh.../\nDon't move\\, kid!";

  test("tách: nhãn người nói + các dòng thoại; \\, → dấu phẩy", () => {
    const c = splitCell(cell, "message", "dialogue", "sheet.csv", 5, 3);
    expect(c.pieces.map(p => [p.entry.kind, p.entry.source, p.entry.path])).toEqual([
      ["speaker", "Thug A", [5, 3, 0]],
      ["dialogue", "Heeeh...", [5, 3, 1]],
      ["dialogue", "Don't move, kid!", [5, 3, 2]],
    ]);
    // chưa dịch → ghép lại đúng nguyên văn
    expect(joinCell(c, "message", new Map())).toBe(cell);
  });

  test("nhãn chỉ có mã tên (\\n[2]) → không có gì để dịch", () => {
    const c = splitCell("\\c[6][\\n[2]]\\c[0]/\nHello!", "message", "dialogue", "f", 0, 3);
    expect(c.pieces.map(p => p.entry.source)).toEqual(["Hello!"]);
  });

  test("gộp dòng để dịch, ghi lại giữ \"/\"; dòng thừa bị bỏ, dòng cuối kết thúc như gốc", () => {
    const c = splitCell(cell, "message", "dialogue", "sheet.csv", 5, 3);
    const units = buildUnits(c.pieces.map(p => p.entry), { maxChars: 80 });
    const dialogue = units.find(u => u.entries.length === 2)!;
    expect(dialogue.segments[0].text).toBe("Heeeh... Don't move, kid!");
    dialogue.assemble(["Hừm... Đứng yên, nhóc!"]);
    const t = new Map<Piece, string | undefined>(c.pieces.map(p => [p, p.entry.target]));
    expect(joinCell(c, "message", t)).toBe("\\c[6][Thug A]\\c[0]/\nHừm... Đứng yên, nhóc!");
  });

  test("bản dịch dài hơn → thêm dòng, mỗi lần xuống dòng vẫn có \"/\"", () => {
    const c = splitCell("A/\nB", "message", "dialogue", "f", 0, 3);
    const [a, b] = c.pieces;
    const out = joinCell(c, "message", new Map([[a, "Một/"], [b, "Hai\nBa"]]));
    expect(out).toBe("Một//\nHai\nBa");
    const c2 = splitCell("A/\nB/", "message", "dialogue", "f", 0, 3);
    expect(joinCell(c2, "message", new Map([[c2.pieces[1], "Hai\nBa"]]))).toBe("A/\nHai/\nBa/");
  });

  test("tiến độ nhiệm vụ: giữ $progressN=, script @ec(...) được bảo vệ", () => {
    const c = splitCell("$progress1=Kill \\c[2]@ec((10 - $gameParty.numItems($dataItems[3])))\\c[0] rats.\n$progress99=Complete!",
      "progress", "description", "QuestList.csv", 2, 17);
    expect(c.pieces.map(p => p.pre)).toEqual(["$progress1=", "$progress99="]);
    expect(protect(c.pieces[0].entry.source).text).toBe("Kill {0}{1}{2} rats.");
  });
});

describe("bảo vệ mã", () => {
  test("mã nội dung (\\n[1] tên, \\v[2] biến) ở đầu dòng là một phần của câu", () => {
    expect(splitAffix("\\c[2]\\n[1] noticed it.\\I[5]")).toEqual({ prefix: "\\c[2]", core: "\\n[1] noticed it.", suffix: "\\I[5]" });
  });

  test("mã 2 dấu gạch \\\\c[27]", () => {
    expect(protect("\\\\c[27][Increase]\\\\v[59]").tokens).toEqual(["\\\\c[27]", "\\\\v[59]"]);
  });

  test("mã cuối dòng giữa khối thoại không bị mất", () => {
    const e = (i: number, s: string) => ({ file: "f", path: [0, 3, i], kind: "dialogue" as const, source: s, block: "0:3" });
    const [u] = buildUnits([e(0, "Mmm!\\I[122]"), e(1, "So good!")], { maxChars: 80 });
    expect(u.segments[0].text).toBe("Mmm!{0} So good!");
  });
});

describe("glossary", () => {
  test("bỏ tên là từ thông dụng (xuất hiện viết thường trong game)", () => {
    const texts = ["My uncle crossed the bridge.", "A tiny bit of justice."];
    expect(dropCommonWords(["Uncle", "Bridge", "MoyoMoyo", "Tiny Justice", "Guild receptionist", "The Voice"], texts))
      .toEqual(["MoyoMoyo", "Tiny Justice"]);
  });
});

describe("chế độ data: không dịch mã tham chiếu CSV", () => {
  test("event_data_base_text_12 bị bỏ qua", () => {
    const map = { displayName: "", events: [null, { pages: [{ list: [
      { code: 401, parameters: ["event_data_base_text_12-14"] },
      { code: 401, parameters: ["Real text"] },
    ] }] }] };
    expect(extractFile("Map001.json", "story", map).map(e => e.source)).toEqual(["Real text"]);
  });
});

/** Game giả dùng KNS_CsvReader. */
function fakeKnsGame() {
  const root = mkdtempSync(join(tmpdir(), "kns-"));
  const www = join(root, "www");
  for (const d of ["data", "js/plugins", "../csv"]) mkdirSync(join(www, d), { recursive: true });
  writeFileSync(join(www, "data", "System.json"), "{}");
  writeFileSync(join(www, "js", "rpg_core.js"), "");
  writeFileSync(join(www, "js", "plugins.js"), `var $plugins = [{"name":"KNS_CsvReader","status":true,"description":"","parameters":{}}];`);
  writeFileSync(join(www, "js", "plugins", "KNS_CsvReader.js"), `/*:
 * @plugindesc ver.1.3.1 test
 */
(function(){ this.databases = [
  ["DB_Actor", this.onLoadObject.bind(this, "$dataActors", [["name", 0], ["nickname", 1], ["description", 2]], 1, 3)],
  ["DB_Item", this.onLoadObject.bind(this, "$dataItems", [["name", 0], ["description", 1]], 2, 2)],
  ["sheet", this.onLoadSheet.bind(this)],
]; })`);
  const csv = join(root, "csv");
  writeFileSync(join(csv, "language.csv"), "jp\r\nen\r\n");
  writeFileSync(join(csv, "DB_Actor.csv"), "$id=0,JPN,nick,desc,ENG,nick,desc\r\n$id=1,レオン,,,Leon,,The hero\r\n");
  writeFileSync(join(csv, "DB_Item.csv"), '$id=0,free,JPN,DESC,ENG,DESC\r\n$id=2,,薬草,"回復",Herb,"Heals 5 HP.\r\nTasty."\r\n$id=3,,毒草,毒,,\r\n');
  writeFileSync(join(csv, "sheet.csv"), ',script,jp,en\r\n$map1,,,\r\n$text1,$v[1] = 0,"\\c[6][\\n[2]]\\c[0]/\r\nこんにちは","\\c[6][\\n[2]]\\c[0]/\r\nLeon\\, hello!/\r\nHow are you?"\r\n');
  writeFileSync(join(csv, "EnemyData.csv"), "id,name\r\n101,enemy_name_rat\r\n");
  return root;
}

describe("bộ đọc rpgm-kns-csv", () => {
  test("nhận diện, đọc quy tắc từ plugin, ưu tiên hơn data", () => {
    const fs = detectFormats(fakeKnsGame());
    expect(fs.map(f => f.id)).toEqual(["rpgm-kns-csv", "rpgm-data"]);
    const files = Object.fromEntries(fs[0].files.map(f => [f.name, f.hasText]));
    expect(files).toMatchObject({ "DB_Item.csv": true, "sheet.csv": true, "EnemyData.csv": false, "language.csv": false });
  });

  test("đọc cột EN (trống thì JP), ghi bản dịch vào cột EN, cột khác không đổi", () => {
    const root = fakeKnsGame();
    const work = mkdtempSync(join(tmpdir(), "work-"));
    const paths = { root, outDir: join(work, "out"), projDir: join(work, "proj") };
    const fmt = detectFormats(root)[0];
    fmt.snapshot(paths, false);
    const src = fmt.sourceDir(paths);

    const items = fmt.load(src, "DB_Item.csv");
    expect(items.roundtripOk()).toBe(true);
    expect(items.entries.map(e => [e.path, e.source])).toEqual([
      [[1, 4], "Herb"], [[1, 5], "Heals 5 HP.\nTasty."], [[2, 4], "毒草"], [[2, 5], "毒"],
    ]);
    const out = join(paths.outDir, "csv", "DB_Item.csv");
    items.write(out, items.entries.map(e => ({ ...e, target: "VI:" + e.source })));
    const rows = values(readFileSync(out, "utf8"));
    expect(rows[1]).toEqual(["$id=2", "", "薬草", "回復", "VI:Herb", "VI:Heals 5 HP.\nTasty."]);
    expect(rows[2]).toEqual(["$id=3", "", "毒草", "毒", "VI:毒草", "VI:毒"]);

    const actors = fmt.load(src, "DB_Actor.csv");
    // tên: kiểu speaker (chỉ đổi theo tên đã duyệt), mô tả dịch bình thường
    expect(actors.entries.map(e => [e.kind, e.source])).toEqual([["speaker", "Leon"], ["description", "The hero"]]);
    expect(fmt.keepNames?.(src)).toEqual(["Leon"]);
    expect(fmt.actorNames?.(src)).toEqual([{ id: 1, name: "Leon" }]);

    const sheet = fmt.load(src, "sheet.csv");
    expect(sheet.entries.map(e => e.source)).toEqual(["Leon, hello!", "How are you?"]);
    // chưa dịch gì → file ghi ra giống hệt bản gốc
    const same = join(paths.outDir, "csv", "sheet.csv");
    sheet.write(same, sheet.entries);
    expect(readFileSync(same, "utf8")).toBe(readFileSync(join(src, "sheet.csv"), "utf8"));
  });

  test("export vào thư mục csv/ ở ngoài (cạnh Game.exe)", () => {
    const root = fakeKnsGame();
    const fmt = detectFormats(root)[0];
    const [g] = fmt.exportGroups({ root, outDir: "o", projDir: "p" });
    expect(g.prefix).toBe("csv/");
    expect(g.gameDir).toBe(join(root, "csv"));
  });
});
