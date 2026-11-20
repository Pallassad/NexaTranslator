import { safeStorage } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KeyStore } from "../src/app";

/**
 * Kho API key MÃ HÓA bằng Windows (Electron safeStorage → DPAPI, gắn với tài khoản Windows đang đăng nhập).
 * File keys.json chỉ chứa chuỗi đã mã hóa: chép sang máy / tài khoản khác cũng không giải mã được.
 *
 * Key KHÔNG bao giờ được gửi sang giao diện – giao diện chỉ biết "đã có" hay "chưa có".
 */
export class EncryptedKeyStore implements KeyStore {
  private file: string;
  /** Tên biến môi trường có key lấy từ kho này (để phân biệt với key trong .env). */
  readonly loaded = new Set<string>();

  constructor(dataDir: string) {
    this.file = join(dataDir, "keys.json");
  }

  get available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    try { return JSON.parse(readFileSync(this.file, "utf8")); } catch { return {}; }
  }

  /** Nạp key đã lưu vào process.env (lõi đọc key từ đó). Key trong kho được ưu tiên hơn .env. */
  loadIntoEnv(): void {
    for (const [keyEnv, b64] of Object.entries(this.read())) {
      try {
        process.env[keyEnv] = safeStorage.decryptString(Buffer.from(b64, "base64"));
        this.loaded.add(keyEnv);
      } catch {
        // Không giải mã được (file chép từ máy khác) → bỏ qua, người dùng nhập lại
      }
    }
  }

  save(keyEnv: string, key: string): string {
    if (!this.available) throw new Error("Windows không cho dùng kho mã hóa trên máy này – chưa lưu được key.");
    const data = this.read();
    data[keyEnv] = safeStorage.encryptString(key).toString("base64");
    writeFileSync(this.file, JSON.stringify(data, null, 2), "utf8");
    process.env[keyEnv] = key;
    this.loaded.add(keyEnv);
    return "kho mã hóa của Windows";
  }
}
