import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  createContext,
  openGame,
  prepareTranslation,
  runTranslate,
} from "../src/app";
import { protect } from "../src/core/protect";
import { splitEven } from "../src/core/units";

/** Game giả dùng www/loc: chữ nằm ngoài data/. */
function fakeGame(): string {
  const root = join(mkdtempSync(join(tmpdir(), "rem-")), "Game");
  const www = join(root, "www");
  for (const d of ["data", "js", "loc"])
    mkdirSync(join(www, d), { recursive: true });
  writeFileSync(join(www, "js", "rpg_core.js"), "");
  writeFileSync(
    join(www, "data", "System.json"),
    JSON.stringify({ gameTitle: "KP" }),
  );
  writeFileSync(
    join(www, "data", "Actors.json"),
    JSON.stringify([null, { name: "Alice" }]),
  );
  const loc = (n: string, d: unknown) =>
    writeFileSync(join(www, "loc", n), JSON.stringify(d));
  loc("RemMap_EN.json", {
    ev1: { text: ["", "\\#The guards lead Alice into the storage room."] },
    ev2: {
      text: [
        "Y-Yes Madam!",
        "Prison Level \\V[35] has started \\C[10]Rioting\\C[0]!!",
      ],
    },
  });
  loc("RemDesc_EN.json", {
    skill_51_name: { text: ["Strike"] },
    skill_51_desc: {
      text: [
        "\\C[11]Deals damage to one enemy,",
        "\\C[11]and lowers its defense",
      ],
    },
    actor_1_name: { text: ["Alice"] },
  });
  loc("RemEff.json", {
    skill_115_effect: { text: ["\\REM_DESC[peffect_maxmouthdesire]"] },
  });
  loc("RemLines.json", {
    l1: {
      en: [
        '\\C[15]"Take your filthy eyeballs,',
        '\\fb\\C[5]and dump them into the trash."',
      ],
      jp: ["「ゲヘヘッ」"],
    },
    l2: { en: ['\\fb\\C[5]""'], jp: ["\\fb\\C[5]「」"] },
  });
  loc("RemMap_JP.json", { ev1: { text: ["日本語"] } });
  return root;
}

describe("bộ đọc rpgm-rem-loc ", () => {
  test("nhận diện, ưu tiên hơn data/, chỉ lấy dòng có chữ", () => {
    const ctx = createContext({
      workDir: mkdtempSync(join(tmpdir(), "w-")),
      emit: () => {},
    });
    const s = openGame(ctx, fakeGame());
    expect(s.formats.map((f) => f.id)).toEqual(["rpgm-rem-loc", "rpgm-data"]);
    const files = Object.fromEntries(
      s.loadEntries(s.fmt, s.sourceDir()).map((f) => [f.name, f.entries]),
    );
    expect(Object.keys(files).sort()).toEqual([
      "RemDesc_EN.json",
      "RemLines.json",
      "RemMap_EN.json",
    ]); // RemEff chỉ có mã
    expect(files["RemLines.json"].map((e) => e.source)).toHaveLength(2); // bỏ dòng \fb\C[5]""
    expect(files["RemDesc_EN.json"].map((e) => e.kind)).toEqual([
      "name",
      "dialogue",
      "dialogue",
      "speaker",
    ]);
  });

  test("dịch: giữ khóa + mã, giữ số dòng mô tả / thoại trận, không đụng tiếng khác", async () => {
    const ctx = createContext({
      workDir: mkdtempSync(join(tmpdir(), "w-")),
      emit: () => {},
    });
    const root = fakeGame();
    const s = openGame(ctx, root);
    const plan = prepareTranslation(ctx, s);
    try {
      const r = await runTranslate(ctx, s, plan, { engines: ["mock"] });
      expect(r.status).toBe("done");
      expect(r.errorCount).toBe(0);
    } finally {
      plan.close();
    }
    const out = (n: string) =>
      JSON.parse(readFileSync(join(s.fmtOut, n), "utf8"));
    const lines = out("RemLines.json");
    expect(lines.l1.en).toHaveLength(2);
    expect(lines.l1.en.join(" ")).toContain("\\fb\\C[5]");
    expect(lines.l1.jp).toEqual(["「ゲヘヘッ」"]);
    expect(lines.l2.en).toEqual(['\\fb\\C[5]""']);
    const desc = out("RemDesc_EN.json");
    expect(desc.skill_51_name.text).toEqual(["[VI] Strike"]);
    expect(desc.skill_51_desc.text).toHaveLength(2);
    expect(desc.actor_1_name.text).toEqual(["Alice"]); // tên nhân vật: chỉ đổi theo glossary
    const map = out("RemMap_EN.json");
    expect(map.ev1.text[0]).toBe("");
    expect(map.ev2.text).toHaveLength(2); // câu ngắn: chia đều, không để dòng trống
    expect(map.ev2.text.every((l: string) => l.trim())).toBe(true);
    expect(map.ev2.text.join(" ")).toContain("\\V[35]");
  });
});

describe("phụ trợ", () => {
  test("splitEven chia đúng số dòng", () => {
    expect(splitEven("một hai ba bốn", 2)).toEqual(["một hai", "ba bốn"]);
    expect(splitEven("một", 3)).toEqual(["một", "", ""]);
    expect(splitEven("a b c d e f", 3)).toEqual(["a b", "c d", "e f"]);
  });

  test("bảo vệ mã \\REM_DESC[...] và \\fb", () => {
    expect(protect("See \\REM_DESC[skill_51_name] now").tokens).toEqual([
      "\\REM_DESC[skill_51_name]",
    ]);
    expect(protect("bold \\fb text").tokens).toEqual(["\\fb"]);
  });
});
