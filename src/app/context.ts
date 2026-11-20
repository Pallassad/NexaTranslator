import { join } from "node:path";
import { loadConfig, type AppConfig } from "../core/config";
import { setLogSink } from "../core/log";
import { setEnvValue } from "../core/env";
import { denyAll, type AppEvent, type Prompter } from "./events";

/**
 * Mọi thứ lớp app/ cần để chạy: cấu hình, thư mục làm việc, nơi gửi sự kiện, cách hỏi người dùng.
 * Tạo 1 lần khi mở CLI / khởi động Electron.
 */
export interface AppContext {
  cfg: AppConfig;
  /** Thư mục chứa config.json, .env, glossary.json chung, output/, projects/. */
  workDir: string;
  emit(e: AppEvent): void;
  prompt: Prompter;
  /** Nơi lưu API key. CLI: file .env. Electron: kho mã hóa của Windows (safeStorage). */
  keyStore: KeyStore;
}

export interface KeyStore {
  /** Lưu key, trả về mô tả nơi đã lưu (để báo cho người dùng). */
  save(keyEnv: string, key: string): string;
}

/** Mặc định (CLI): ghi KEY=value vào <workDir>/.env. */
export const envKeyStore = (workDir: string): KeyStore => ({
  save(keyEnv, key) {
    const p = join(workDir, ".env");
    setEnvValue(p, keyEnv, key);
    return p;
  },
});

export interface ContextOptions {
  /** Mặc định "." (thư mục đang đứng) – giống CLI cũ. Electron sẽ truyền thư mục dữ liệu của app. */
  workDir?: string;
  emit?: (e: AppEvent) => void;
  prompt?: Prompter;
  /** Ghi đè cfg.delayMs (tùy chọn --delay). */
  delayMs?: number;
  keyStore?: KeyStore;
}

export function createContext(opt: ContextOptions = {}): AppContext {
  const workDir = opt.workDir ?? ".";
  const cfg = loadConfig(join(workDir, "config.json"), join(workDir, ".env"));
  if (opt.delayMs !== undefined && !Number.isNaN(opt.delayMs)) cfg.delayMs = opt.delayMs;
  const emit = opt.emit ?? (() => {});
  // Thông báo phụ từ lõi (thử lại, đổi endpoint...) → thành sự kiện
  setLogSink(message => emit({ type: "log", level: "warn", message }));
  return { cfg, workDir, emit, prompt: opt.prompt ?? denyAll, keyStore: opt.keyStore ?? envKeyStore(workDir) };
}
