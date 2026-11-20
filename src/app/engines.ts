import { createProvider, isPaidEngine, KEY_ENV, type AppConfig } from "../core/config";
import { estimateCost, estimateMinutes } from "../core/estimate";
import { ChainProvider } from "../core/providers/chain";
import type { TranslationProvider } from "../core/providers/types";
import type { AppContext } from "./context";
import type { PaidReason } from "./events";

/** Tên model của engine (để tra bảng giá). */
export function modelOf(cfg: AppConfig, name: string): string {
  if (name === "claude-haiku") return "claude-haiku-5-5";
  if (name === "claude-sonnet") return "claude-sonnet-5-5";
  if (name === "claude") return cfg.claude?.model ?? "claude-haiku-5-5";
  if (name === "ai") return process.env.AI_MODEL || cfg.ai?.model || "?";
  return name;
}

/** Tạo các engine miễn phí; engine thiếu key thì bỏ qua và báo. */
export function buildFree(ctx: AppContext, names: string[]): TranslationProvider[] {
  const list: TranslationProvider[] = [];
  for (const n of names) {
    const p = createProvider(n, ctx.cfg);
    if ("missing" in p) ctx.emit({ type: "log", level: "warn", message: `ℹ Bỏ qua engine "${n}": ${p.missing}` });
    else list.push(p);
  }
  return list;
}

/** Thử dịch 1 câu ngắn để kiểm tra engine / key (tốn rất ít token). */
export async function testProvider(ctx: AppContext, p: TranslationProvider): Promise<string> {
  const [r] = await p.translateBatch(["Hello, how are you?"], "en", ctx.cfg.to);
  if (r == null) throw new Error("engine không trả về bản dịch");
  return r;
}

/**
 * Hỏi key (tối đa 3 lần), dịch thử để kiểm tra, hỏi có lưu vào .env không.
 * Lưu qua ctx.keyStore (CLI: .env, Electron: kho mã hóa). Trả false nếu người dùng hủy hoặc nhập sai 3 lần.
 */
export async function ensureKey(ctx: AppContext, engine: string, keyEnv: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const key = (await ctx.prompt.askKey({ engine, keyEnv, attempt }))?.trim();
    if (!key) return false;
    process.env[keyEnv] = key;
    const p = createProvider(engine, ctx.cfg, { retries: 1 });
    if ("missing" in p) {
      ctx.emit({ type: "key-check", ok: false, message: p.missing });
      return false;
    }
    try {
      const r = await testProvider(ctx, p);
      ctx.emit({ type: "key-check", ok: true, message: `Key dùng được (thử dịch: "${r}")` });
      if (await ctx.prompt.confirmSaveKey(engine)) {
        ctx.emit({ type: "key-saved", where: ctx.keyStore.save(keyEnv, key) });
      }
      return true;
    } catch (e: any) {
      ctx.emit({ type: "key-check", ok: false, message: e.reason ?? e.message });
      delete process.env[keyEnv];
    }
  }
  return false;
}

export type SetKeyResult = "saved" | "cancelled" | "unknown-engine";

/**
 * Lệnh set-key: nhập key cho 1 engine.
 * Claude / AI: kiểm tra key trước khi lưu. Azure / DeepL: lưu luôn (không dịch thử).
 */
export async function setKey(ctx: AppContext, engine: string): Promise<SetKeyResult> {
  const base = engine.startsWith("claude") ? "claude" : engine;
  const keyEnv = KEY_ENV[base];
  if (!keyEnv) return "unknown-engine";
  if (base === "azure" || base === "deepl") {
    const key = (await ctx.prompt.askKey({ engine: base, keyEnv, attempt: 1 }))?.trim();
    if (!key) return "cancelled";
    ctx.emit({ type: "key-saved", where: ctx.keyStore.save(keyEnv, key) });
    return "saved";
  }
  return (await ensureKey(ctx, base, keyEnv)) ? "saved" : "cancelled";
}

export interface EngineCheck {
  engine: string;
  status: "ok" | "missing" | "error";
  /** ok: câu dịch thử; missing / error: lý do. */
  detail: string;
  /** Có khi thiếu key → gợi ý set-key. */
  keyEnv?: string;
}

/** Kiểm tra engine nào đang dùng được (engine AI dịch thử 1 câu ngắn). */
export async function checkEngines(ctx: AppContext, names?: string[]): Promise<EngineCheck[]> {
  const list = names?.length
    ? names
    : [...ctx.cfg.engines, ...(ctx.cfg.paidEngine ? [ctx.cfg.paidEngine] : [])];
  const rows: EngineCheck[] = [];
  for (const n of list) {
    const p = createProvider(n, ctx.cfg, { retries: 1 });
    if ("missing" in p) {
      rows.push({ engine: n, status: "missing", detail: p.missing, keyEnv: p.keyEnv });
      continue;
    }
    try {
      rows.push({ engine: p.name, status: "ok", detail: await testProvider(ctx, p) });
    } catch (e: any) {
      rows.push({ engine: p.name, status: "error", detail: e.reason ?? e.message });
    }
  }
  return rows;
}

/** Bộ engine cho 1 lần dịch. */
export interface EngineSetup {
  /** Engine miễn phí (chuỗi dự phòng); null nếu chỉ dùng engine trả phí. */
  free: TranslationProvider | null;
  /** Tên engine trả phí (hỏi trước khi dùng). */
  paidName?: string;
  /** Engine dự phòng cho câu AI từ chối dịch (bản riêng, không chung trạng thái "bị chặn"). */
  fallback?: TranslationProvider;
}

/** @param names danh sách engine người dùng chọn (--engine); không có → theo config.json. */
export function setupEngines(ctx: AppContext, names?: string[]): EngineSetup {
  const list = (names?.length ? names : ctx.cfg.engines).map(s => s.trim().toLowerCase()).filter(Boolean);
  const freeNames = list.filter(n => !isPaidEngine(n));
  const paidName = list.find(isPaidEngine) ?? (ctx.cfg.paidEngine || undefined);
  const freeList = freeNames.length ? buildFree(ctx, freeNames) : [];
  const fallbackList = buildFree(ctx, freeNames.length ? freeNames : ["google"]);
  return {
    free: freeList.length ? new ChainProvider(freeList) : null,
    paidName,
    fallback: fallbackList.length ? new ChainProvider(fallbackList) : undefined,
  };
}

/**
 * HỎI người dùng trước khi dùng engine trả phí; thiếu key thì yêu cầu nhập.
 * Trả null nếu người dùng từ chối / hủy.
 */
export async function offerPaid(
  ctx: AppContext, paidName: string, remaining: string[], maxCost?: number, reason: PaidReason = "blocked",
): Promise<TranslationProvider | null> {
  const { cfg } = ctx;
  const chars = remaining.reduce((n, s) => n + s.length, 0);
  const model = modelOf(cfg, paidName);
  const price = cfg.pricing?.[model];
  const ok = await ctx.prompt.confirmPaid({
    engine: paidName, model, sentences: remaining.length, chars, maxCost, reason,
    cost: price ? estimateCost(chars, remaining.length, price, cfg.claude?.batchSize) : undefined,
    minutes: estimateMinutes("ai", chars, remaining.length, cfg.claude?.batchSize),
  });
  if (!ok) return null;

  let p = createProvider(paidName, cfg);
  if ("missing" in p) {
    if (!p.keyEnv) {
      ctx.emit({ type: "log", level: "warn", message: `❌ ${p.missing}` });
      return null;
    }
    ctx.emit({ type: "log", level: "info", message: `Chưa có API key (${p.keyEnv}).` });
    if (!(await ensureKey(ctx, paidName, p.keyEnv))) return null;
    p = createProvider(paidName, cfg);
    if ("missing" in p) return null;
  }
  return p;
}
