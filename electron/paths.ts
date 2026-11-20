import { app } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Thư mục dữ liệu (bản PORTABLE – để cạnh file .exe):
 *   config.json, library.json, keys.json, output/, projects/, glossary.json chung.
 *
 *  - Đóng gói dạng portable (electron-builder): exe tự giải nén vào thư mục tạm, nên phải lấy
 *    PORTABLE_EXECUTABLE_DIR = thư mục chứa file .exe thật.
 *  - Đóng gói dạng thư mục: thư mục chứa Nexa Translation.exe.
 *  - Đang phát triển (npm run app:dev): thư mục dự án → dùng chung output/, projects/ với CLI.
 */
export function dataDir(): string {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) return dirname(process.execPath);
  return process.cwd();
}

/** Thư mục chứa main.mjs sau khi build (dist-electron/). */
export const buildDir = dirname(fileURLToPath(import.meta.url));

/** assets/ (font kèm theo tool). Đóng gói: nằm trong resources/. */
export function assetsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, "assets") : join(buildDir, "..", "assets");
}
