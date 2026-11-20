import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createContext, openGame, prepareTranslation, runTranslate } from "../src/app";

/** Game giả dùng VisuStella Languages.tsv. */
function fakeGame(): string {
  const root = join(mkdtempSync(join(tmpdir(), "tsv-")), "Game");
  for (const d of ["data", "js"]) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, "js", "rmmz_core.js"), "");
  writeFileSync(join(root, "data", "System.json"), JSON.stringify({ gameTitle: "T" }));
  writeFileSync(join(root, "data", "Actors.json"), JSON.stringify([null, { name: "Lina" }]));
  const list = [
    { code: 401, parameters: ["\\c[24]\\tl{A0002}"] },
    { code: 401, parameters: ["\\tl{A0003}"] },
    { code: 0, parameters: [] },
  ];
  writeFileSync(join(root, "data", "CommonEvents.json"), JSON.stringify([null, { list }]));
  writeFileSync(join(root, "data", "Languages.tsv"), [
    "Key\tEnglish\tChinese(Simplified)",
    "A0001\tQuest\t任务",
    "A0002\t\\c[1]Hello, \\.traveler!\t你好",
    "A0003\t\t只有中文",
    "A0004\t\\i[186]\t\\i[186]",
  ].join("\r\n") + "\r\n");
  return root;
}

describe("bộ đọc rpgm-lang-tsv (VisuStella Languages.tsv)", () => {
  test("thay cột English, giữ nguyên cột khác / CRLF / mã; ô English trống dịch từ cột khác", async () => {
    const ctx = createContext({ workDir: mkdtempSync(join(tmpdir(), "w-")), emit: () => {} });
    const s = openGame(ctx, fakeGame());
    expect(s.formats.map(f => f.id)).toEqual(["rpgm-lang-tsv", "rpgm-data"]);
    const plan = prepareTranslation(ctx, s);
    try {
      expect(plan.summary().lines).toBe(3);   // A0004 chỉ có mã → bỏ qua
      const r = await runTranslate(ctx, s, plan, { engines: ["mock"] });
      expect(r.status).toBe("done");
    } finally { plan.close(); }
    const out = readFileSync(join(s.fmtOut, "Languages.tsv"), "utf8").split("\r\n");
    expect(out[0]).toBe("Key\tEnglish\tChinese(Simplified)");
    expect(out[2]).toBe("A0002\t\\c[1][VI] Hello, \\.traveler!\t你好");
    expect(out[3]).toBe("A0003\t[VI] 只有中文\t只有中文");
    expect(out[4]).toBe("A0004\t\\i[186]\t\\i[186]");
    expect(out[5]).toBe("");
  });

  test("data/: dòng chỉ có mã \\tl{...} giữ nguyên từng dòng, không gộp", async () => {
    const ctx = createContext({ workDir: mkdtempSync(join(tmpdir(), "w-")), emit: () => {} });
    const s = openGame(ctx, fakeGame(), { format: "rpgm-data" });
    const plan = prepareTranslation(ctx, s);
    try { await runTranslate(ctx, s, plan, { engines: ["mock"] }); } finally { plan.close(); }
    const ce = JSON.parse(readFileSync(join(s.fmtOut, "CommonEvents.json"), "utf8"));
    expect(ce[1].list.slice(0, 2).map((c: any) => c.parameters[0])).toEqual(["\\c[24]\\tl{A0002}", "\\tl{A0003}"]);
  });
});
