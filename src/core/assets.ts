import { fileURLToPath } from "node:url";

/**
 * Thư mục assets/ của tool (font, từ điển Hán Việt...).
 * Chạy bằng tsx (CLI, test): tính theo vị trí file này. App Electron (code đã gộp vào 1 file, nằm chỗ khác)
 * đặt biến môi trường NEXA_ASSETS_DIR trước khi dùng → tính lúc gọi, không tính sẵn lúc nạp file.
 */
export function assetsDir(): string {
  return process.env.NEXA_ASSETS_DIR || fileURLToPath(new URL("../../assets", import.meta.url));
}
