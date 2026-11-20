import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** Tổng dung lượng (byte) và số file của một thư mục. */
export function dirStats(path: string): { bytes: number; files: number } {
  let bytes = 0, files = 0;
  for (const ent of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, ent.name);
    if (ent.isDirectory()) {
      const s = dirStats(p);
      bytes += s.bytes; files += s.files;
    } else {
      bytes += statSync(p).size; files++;
    }
  }
  return { bytes, files };
}

/**
 * Chuyển thư mục vào Thùng rác (Windows) để lỡ tay vẫn khôi phục được.
 * Hệ điều hành khác: xóa hẳn.
 */
export function moveToTrash(path: string): "trash" | "deleted" {
  const abs = resolve(path);
  if (process.platform === "win32") {
    const quoted = abs.replace(/'/g, "''");
    const script =
      "Add-Type -AssemblyName Microsoft.VisualBasic; " +
      `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${quoted}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore" });
    return "trash";
  }
  rmSync(abs, { recursive: true, force: true });
  return "deleted";
}

export const fmtBytes = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`;
