import { existsSync } from "node:fs";
import { readJson, writeJson } from "./writer";
import type { Pricing, TranslationProvider } from "./providers/types";
import { GoogleFreeProvider } from "./providers/google";
import { AzureProvider } from "./providers/azure";
import { DeepLProvider } from "./providers/deepl";
import { AIProvider } from "./providers/ai";
import { ClaudeProvider } from "./providers/claude";
import { MockProvider, MockAIProvider } from "./providers/mock";

/**
 * config.json (được commit lên Git, KHÔNG chứa key). Xem file config.json để biết ví dụ.
 * API key nằm trong .env (KHÔNG commit): CLAUDE_API_KEY, AI_API_KEY, AZURE_KEY, DEEPL_KEY
 */
export interface AppConfig {
  /** Engine miễn phí, dùng theo thứ tự. */
  engines: string[];
  /** Engine trả phí dùng khi engine miễn phí bị chặn (luôn hỏi trước). Để "" nếu không dùng. */
  paidEngine: string;
  from: string;
  to: string;
  delayMs?: number;
  claude?: { model?: string; batchSize?: number; extraPrompt?: string };
  ai?: { baseUrl?: string; model?: string; batchSize?: number; extraPrompt?: string };
  azure?: { region?: string; endpoint?: string };
  /** Giới hạn chi phí mặc định (USD) cho mỗi lần dịch bằng engine trả phí. 0 / không có = không giới hạn. */
  maxCost?: number;
  /** Giá USD / 1 triệu token theo tên model – để ước tính và báo chi phí. */
  pricing?: Record<string, Pricing>;
}

const DEFAULT: AppConfig = {
  engines: ["google"],
  paidEngine: "claude",
  from: "auto",
  to: "vi",
  claude: {
    model: "claude-haiku-5-5", batchSize: 30,
    extraPrompt: "Xưng hô tự nhiên theo ngữ cảnh (anh/em, tôi/cậu, ta/ngươi...). Giữ nguyên tên riêng.",
  },
  maxCost: 1,
  // Giá USD / 1 triệu token (để ước tính chi phí) – sửa trong config.json nếu Anthropic đổi giá
  pricing: {
    "claude-haiku-5-5": { input: 0.1, output: 0.5 },
    "claude-sonnet-5-5": { input: 2, output: 10 },
  },
};

/**
 * Lần đầu chạy (vd bản .exe mới chép sang máy khác) chưa có config.json → tạo file từ cấu hình mặc định
 * để người dùng thấy và sửa được. Đã có thì không đụng tới.
 */
export function ensureConfigFile(configPath: string): boolean {
  if (existsSync(configPath)) return false;
  writeJson(configPath, { ...DEFAULT, ai: { baseUrl: "", model: "", batchSize: 30 } }, true);
  return true;
}

/** Phần cài đặt sửa được trong app. */
export interface ConfigPatch {
  paidEngine?: string;
  from?: string;
  /** null = không giới hạn. */
  maxCost?: number | null;
}

/**
 * Ghi các mục người dùng đổi vào config.json, GIỮ NGUYÊN mọi mục khác (pricing, ai, delayMs...).
 * Trả về cấu hình mới (đọc lại từ file).
 */
export function saveConfig(configPath: string, patch: ConfigPatch): AppConfig {
  const raw = existsSync(configPath) ? (readJson(configPath) as Record<string, unknown>) : {};
  if (patch.paidEngine !== undefined) raw.paidEngine = patch.paidEngine;
  if (patch.from !== undefined) raw.from = patch.from;
  if (patch.maxCost !== undefined) raw.maxCost = patch.maxCost ?? 0;
  writeJson(configPath, raw, true);
  return loadConfig(configPath, "");
}

export const ENGINE_NAMES = ["google", "claude", "claude-haiku", "claude-sonnet", "ai", "azure", "deepl", "mock"] as const;

/** Tên biến môi trường chứa key của từng engine. */
export const KEY_ENV: Record<string, string> = {
  claude: "CLAUDE_API_KEY", ai: "AI_API_KEY", azure: "AZURE_KEY", deepl: "DEEPL_KEY",
};

export function loadConfig(configPath = "config.json", envPath = ".env"): AppConfig {
  if (envPath && existsSync(envPath)) process.loadEnvFile(envPath);
  const user = existsSync(configPath) ? (readJson(configPath) as Partial<AppConfig>) : {};
  return { ...DEFAULT, ...user, claude: { ...DEFAULT.claude, ...user.claude } };
}

/** Engine có tính tiền không (không cần tạo engine). */
export function isPaidEngine(name: string): boolean {
  return name.startsWith("claude") || name === "ai" || name === "mock-ai";
}

/** Tạo 1 engine theo tên. Thiếu key → trả lý do để báo người dùng. */
export function createProvider(
  name: string, cfg: AppConfig, opt: { retries?: number } = {},
): TranslationProvider | { missing: string; keyEnv?: string } {
  const env = process.env;
  switch (name) {
    case "google":
      return new GoogleFreeProvider({ delayMs: cfg.delayMs, retries: opt.retries });
    case "mock":
      return new MockProvider();
    case "mock-ai":
      return new MockAIProvider();
    case "claude":
    case "claude-haiku":
    case "claude-sonnet": {
      if (!env.CLAUDE_API_KEY) return { missing: "chưa có CLAUDE_API_KEY", keyEnv: "CLAUDE_API_KEY" };
      const model = name === "claude-haiku" ? "claude-haiku-5-5"
        : name === "claude-sonnet" ? "claude-sonnet-5-5"
        : cfg.claude?.model ?? "claude-haiku-5-5";
      return new ClaudeProvider({
        apiKey: env.CLAUDE_API_KEY, model, retries: opt.retries,
        batchSize: cfg.claude?.batchSize, extraPrompt: cfg.claude?.extraPrompt,
        pricing: cfg.pricing?.[model],
      });
    }
    case "ai": {
      const model = env.AI_MODEL || cfg.ai?.model;
      const baseUrl = env.AI_BASE_URL || cfg.ai?.baseUrl;
      if (!env.AI_API_KEY) return { missing: "chưa có AI_API_KEY", keyEnv: "AI_API_KEY" };
      if (!model || !baseUrl) return { missing: "chưa khai báo ai.model và ai.baseUrl trong config.json" };
      return new AIProvider({
        apiKey: env.AI_API_KEY, baseUrl, model, retries: opt.retries,
        batchSize: cfg.ai?.batchSize, extraPrompt: cfg.ai?.extraPrompt,
        pricing: cfg.pricing?.[model],
      });
    }
    case "azure":
      if (!env.AZURE_KEY) return { missing: "chưa có AZURE_KEY", keyEnv: "AZURE_KEY" };
      return new AzureProvider({ key: env.AZURE_KEY, region: env.AZURE_REGION || cfg.azure?.region, endpoint: cfg.azure?.endpoint });
    case "deepl":
      if (!env.DEEPL_KEY) return { missing: "chưa có DEEPL_KEY", keyEnv: "DEEPL_KEY" };
      return new DeepLProvider({ key: env.DEEPL_KEY });
    default:
      return { missing: `không có engine tên "${name}" (có: ${ENGINE_NAMES.join(", ")})` };
  }
}
