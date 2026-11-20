// Build tiến trình chính (main.mjs, ESM) và preload (preload.cjs – cửa sổ sandbox chỉ chạy được CommonJS).
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  sourcemap: true,
  packages: "external",   // electron, fontkit... lấy từ node_modules lúc chạy
  logLevel: "warning",
};

export async function buildElectron() {
  await Promise.all([
    build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.mjs", format: "esm" }),
    build({ ...common, entryPoints: ["electron/preload.ts"], outfile: "dist-electron/preload.cjs", format: "cjs" }),
  ]);
}

if (process.argv[1]?.endsWith("build-electron.mjs")) {
  await buildElectron();
  console.log("✓ dist-electron/main.mjs, dist-electron/preload.cjs");
}
