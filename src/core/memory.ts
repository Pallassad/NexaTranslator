import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { readJson } from "./writer";

/**
 * Translation Memory lưu bằng SQLite (có sẵn trong Node, không cần cài thêm).
 * Mỗi câu dịch xong chỉ ghi thêm 1 dòng → nhanh với game lớn (hàng chục nghìn câu),
 * và không mất dữ liệu nếu tool bị tắt giữa chừng.
 *
 * Bảng tm: pair ("auto>vi") | src (câu gốc đã bảo vệ placeholder) | dst (bản dịch) | engine
 */
export class TranslationMemory {
  private db: DatabaseSync;
  private getStmt: StatementSync;
  private setStmt: StatementSync;
  private anyFromStmt: StatementSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tm (
        pair   TEXT NOT NULL,
        src    TEXT NOT NULL,
        dst    TEXT NOT NULL,
        engine TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (pair, src)
      );
      CREATE INDEX IF NOT EXISTS tm_src ON tm (src);
    `);
    this.anyFromStmt = this.db.prepare("SELECT dst FROM tm WHERE src = ? AND pair LIKE ? ESCAPE '\\' LIMIT 1");
    this.getStmt = this.db.prepare("SELECT dst FROM tm WHERE pair = ? AND src = ?");
    this.setStmt = this.db.prepare(
      "INSERT INTO tm (pair, src, dst, engine) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(pair, src) DO UPDATE SET dst = excluded.dst, engine = excluded.engine");

    // Chuyển dữ liệu từ memory.json (phiên bản cũ) nếu có, sau đó đổi tên file cũ
    const legacy = path.replace(/\.db$/, ".json");
    if (legacy !== path && existsSync(legacy)) {
      const data = readJson(legacy) as Record<string, Record<string, string>>;
      this.transaction(() => {
        for (const [pair, map] of Object.entries(data)) {
          for (const [src, dst] of Object.entries(map)) this.setStmt.run(pair, src, dst, "google");
        }
      });
      renameSync(legacy, legacy + ".imported");
    }
  }

  private key(from: string, to: string) { return `${from}>${to}`; }

  /**
   * Bản dịch của câu. Không có cho đúng cặp ngôn ngữ → lấy bản dịch cùng ngôn ngữ đích dịch từ
   * ngôn ngữ gốc khác (vd đã dịch với "auto", sau đổi Cài đặt sang "ja") – câu gốc giống hệt thì
   * không cần dịch lại, đổi ngôn ngữ gốc không làm mất bản dịch cũ.
   */
  get(text: string, from: string, to: string): string | undefined {
    const row = this.getStmt.get(this.key(from, to), text) as { dst: string } | undefined;
    if (row) return row.dst;
    const like = "%>" + to.replace(/[\\%_]/g, c => "\\" + c);
    return (this.anyFromStmt.get(text, like) as { dst: string } | undefined)?.dst;
  }

  set(text: string, translated: string, from: string, to: string, engine = "") {
    this.setStmt.run(this.key(from, to), text, translated, engine);
  }

  /** Ghi nhiều câu trong 1 giao dịch (nhanh hơn nhiều so với ghi từng câu). */
  transaction(fn: () => void) {
    this.db.exec("BEGIN");
    try { fn(); this.db.exec("COMMIT"); }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  /** Số câu đã có trong memory cho cặp ngôn ngữ. */
  count(from: string, to: string): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM tm WHERE pair = ?").get(this.key(from, to)) as { n: number };
    return r.n;
  }

  close() { this.db.close(); }
}
