// npm run app:dev – chạy giao diện (Vite, tự tải lại khi sửa) + Electron.
// Sửa file trong ui/ → cửa sổ tự cập nhật. Sửa electron/ hoặc src/ → tắt app rồi chạy lại lệnh.
import { spawn } from "node:child_process";
import { createServer } from "vite";
import electronPath from "electron";
import { buildElectron } from "./build-electron.mjs";

await buildElectron();
const server = await createServer({ configFile: "ui/vite.config.ts" });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`Giao diện: ${url}`);

const args = ["dist-electron/main.mjs", ...(process.platform === "linux" ? ["--no-sandbox"] : [])];
const child = spawn(electronPath, args, { stdio: "inherit", env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on("exit", code => { server.close(); process.exit(code ?? 0); });
