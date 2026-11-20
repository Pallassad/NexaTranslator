import { join } from "node:path";
import { writeJson } from "../core/writer";
import type { GameSession } from "./session";

export interface ExtractRow {
  file: string;
  lines: number;
  /** Ghi lại không đổi chữ → giống hệt bản gốc. false = bộ đọc có lỗi với file này. */
  roundtripOk: boolean;
}

export interface ExtractResult {
  rows: ExtractRow[];
  totalLines: number;
  /** extract: file entries.json; mark: thư mục bản test. */
  outPath: string;
}

/**
 * extract: trích chữ + kiểm tra ghi lại an toàn, lưu entries.json.
 * mark: tạo bản test, thêm "[VI] " vào mọi dòng (trừ tên người nói).
 */
export function extractOrMark(session: GameSession, mode: "extract" | "mark"): ExtractResult {
  const files = session.loadEntries(session.fmt, session.sourceDir());
  const rows = files.map(f => {
    if (mode === "mark") {
      const marked = f.entries.map(e => (e.kind === "speaker" ? e : { ...e, target: "[VI] " + e.source }));
      f.write(join(session.fmtOut, f.name), marked);
    }
    return { file: f.name, lines: f.entries.length, roundtripOk: f.roundtripOk() };
  });
  const all = files.flatMap(f => f.entries);
  let outPath = session.fmtOut;
  if (mode === "extract") {
    outPath = join(session.reportDir, "entries.json");
    writeJson(outPath, all);
  }
  return { rows, totalLines: all.length, outPath };
}
