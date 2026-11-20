import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Ghi / cập nhật 1 dòng KEY=value trong file .env (giữ nguyên các dòng khác). */
export function setEnvValue(path: string, key: string, value: string) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const i = lines.findIndex(l => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(path, lines.join("\n").replace(/\n*$/, "\n"), "utf8");
  process.env[key] = value;
}
