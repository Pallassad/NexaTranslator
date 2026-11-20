import { createInterface } from "node:readline/promises";

/** Có đang chạy trong terminal thật (hỏi được người dùng) không. */
export const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

/** Hỏi một câu, trả về chuỗi người dùng gõ. */
export async function ask(question: string): Promise<string> {
  if (!interactive) return "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); }
  finally { rl.close(); }
}

/** Hỏi có/không. Không chạy trong terminal thật → mặc định "không". */
export async function confirm(question: string): Promise<boolean> {
  const a = (await ask(`${question} (y/n): `)).toLowerCase();
  return a === "y" || a === "yes" || a === "c" || a === "có";
}

/** Hỏi chuỗi bí mật (API key): hiện dấu * thay vì chữ. */
export function askSecret(question: string): Promise<string> {
  if (!interactive) return Promise.resolve("");
  return new Promise(resolve => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(130); } // Ctrl+C
        if (ch === "\u007f" || ch === "\b") {
          if (value) { value = value.slice(0, -1); process.stdout.write("\b \b"); }
          continue;
        }
        value += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

export { setEnvValue } from "./core/env";
