import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Chính sách bảo mật nội dung (CSP) cho bản build: chỉ chạy code của chính app,
 * ảnh chỉ từ app + icon game (nexa-icon://). Khi dev không gắn vì Vite cần script nội tuyến để tự tải lại.
 */
const csp = (): Plugin => ({
  name: "nexa-csp",
  apply: "build",
  transformIndexHtml: html => html.replace("<head>", `<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: nexa-icon:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'">`),
});

// Giao diện (renderer). Build ra dist/ui, đường dẫn tương đối để Electron mở bằng file://
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react(), csp()],
  build: { outDir: "../dist/ui", emptyOutDir: true },
  server: { port: 5173, strictPort: false },
});
