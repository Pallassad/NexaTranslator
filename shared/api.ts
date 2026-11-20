/**
 * Hợp đồng giữa giao diện (renderer, React) và tiến trình chính (main, Node).
 *
 * Giao diện KHÔNG đọc file hay gọi engine dịch trực tiếp (vì lý do bảo mật của Electron).
 * Mọi việc đi qua window.nexa – được preload.ts tạo ra, main.ts xử lý.
 * File này chỉ chứa KIỂU dữ liệu → dùng chung cho cả hai phía mà không kéo code Node vào giao diện.
 */
import type {
  AppEvent, EngineCheck, ErrorItem, ErrorSegment, EstimateRow, FileItem, FontCheck, GameCard, GlossaryView, KeyRequest, PaidOffer,
  PlanSummary, RetranslateResult, TranslateResult, ActorNamesView, ActorNameRow, UserGlossaryInput,
} from "../src/app";
import type { NameLang, NameSuggestion, NameMethod } from "../src/core/names";
import type { FileResult, RestoreResult } from "../src/core/exporter";

export type {
  AppEvent, EngineCheck, ErrorItem, ErrorSegment, EstimateRow, FileItem, FontCheck, GameCard, GlossaryView, PaidOffer, PlanSummary,
  RetranslateResult, TranslateResult, ActorNamesView, ActorNameRow, UserGlossaryInput, NameLang, NameSuggestion, NameMethod,
};

/** Kết quả sau khi lưu glossary / tên nhân vật. */
export interface GlossarySaveResult {
  /** Số câu phải dịch (lại) vì glossary đổi – 0 = bản dịch đã được ghi lại, chỉ cần Chép vào game. */
  pending: number;
  /** Đã ghi lại bản dịch (output/) với glossary mới. */
  rewritten: boolean;
  view: GameView;
}
export type { FileResult, RestoreResult };

export interface ToolDTO {
  id: string;
  name: string;
  description: string;
  status: "ready" | "soon";
  adapters: { id: string; label: string }[];
}

/** Dữ liệu tab Dịch của 1 game. */
export interface GameView {
  card: GameCard;
  /** Định dạng đang dùng. */
  format: { id: string; label: string; note?: string };
  /** Độ rộng dòng tự đo. */
  autoWidth: number;
  files: FileItem[];
  /** Có Font Doctor không (chỉ game RPG Maker). */
  hasFont: boolean;
  /** Số dòng lỗi mã điều khiển (giữ bản gốc) chưa xem lại. */
  errorLines: number;
  /** Số dòng lỗi người dùng đã chọn "giữ bản gốc" (ẩn khỏi danh sách). */
  reviewedLines: number;
}

export interface EstimateDTO {
  summary: PlanSummary;
  rows: EstimateRow[];
}

export interface TranslateOptionsDTO {
  files: string[];
  width?: number;
  maxCost?: number;
  /**
   * Engine dùng từ đầu: "google" (mặc định – bị chặn thì hỏi chuyển sang AI),
   * "claude-haiku" / "claude-sonnet" (dịch bằng AI ngay, vẫn hỏi xác nhận chi phí trước).
   */
  engine?: TranslateEngine;
}

export const TRANSLATE_ENGINES = ["google", "claude-haiku", "claude-sonnet"] as const;
export type TranslateEngine = (typeof TRANSLATE_ENGINES)[number];

export interface TestPreview extends ExportPreview {
  /** Số file / dòng được đánh dấu [VI]. */
  files: number;
  lines: number;
}

export interface ExportPreview {
  /** Sẽ chép mới / cập nhật. */
  write: string[];
  same: number;
  conflicts: string[];
  missingSource: string[];
}

export interface KeyStatus {
  engine: string;
  keyEnv: string;
  has: boolean;
  /** Nơi đang có key. */
  source?: "encrypted" | "env";
}

export interface SettingsDTO {
  engines: string[];
  /** Engine trả phí dự phòng ("" = không dùng). "claude" cũ được đổi thành claude-haiku / claude-sonnet theo model. */
  paidEngine: string;
  from: string;
  to: string;
  /** Giới hạn chi phí mặc định (USD), null = không giới hạn. */
  maxCost: number | null;
  dataDir: string;
  /** Kho mã hóa của Windows có dùng được không. */
  encryptionAvailable: boolean;
}

/** Các mục cài đặt sửa được trong app. */
export interface SettingsPatch {
  paidEngine?: string;
  from?: string;
  maxCost?: number | null;
}

/** Ngôn ngữ gốc chọn được (mã Google). */
export const SOURCE_LANGS = ["auto", "ja", "zh-CN", "zh-TW", "en", "ko"] as const;
/** Engine trả phí chọn được. */
export const PAID_ENGINES = ["claude-haiku", "claude-sonnet", ""] as const;

/** Câu hỏi main gửi sang giao diện (khi lõi gọi ctx.prompt). */
export type PromptRequest =
  | { id: number; kind: "paid"; offer: PaidOffer }
  | { id: number; kind: "key"; req: KeyRequest }
  | { id: number; kind: "save-key"; engine: string };

/** Lỗi trả qua IPC (giữ được mã lỗi để giao diện hiện hộp thoại phù hợp). */
export interface ApiError {
  message: string;
  code?: "source-invalid" | "not-game" | "busy" | "missing" | "error";
  /** not-game: đoán loại game (vd "Ren'Py"). */
  guess?: string | null;
}

export interface NexaApi {
  tools(): Promise<ToolDTO[]>;
  library: {
    list(tool: string): Promise<GameCard[]>;
    add(tool: string, root: string): Promise<GameCard>;
    remove(id: string): Promise<void>;
    /** Mở hộp thoại chọn thư mục của Windows. null = hủy. */
    pickFolder(): Promise<string | null>;
    /** Đường dẫn thật của file/thư mục người dùng kéo thả vào cửa sổ. */
    pathOf(file: File): string;
  };
  game: {
    /** Mở game: nhận diện + đọc danh sách file (game lớn mất vài giây). */
    open(id: string): Promise<GameView>;
    setFormat(id: string, format: string): Promise<GameView>;
    estimate(id: string, opt: TranslateOptionsDTO): Promise<EstimateDTO>;
    /** Dịch. Tiến độ gửi qua onEvent; câu hỏi qua onPrompt. Xong mới trả kết quả. */
    translate(id: string, opt: TranslateOptionsDTO): Promise<{ result: TranslateResult; view: GameView }>;
    /** Yêu cầu dừng (dừng sau lô đang dịch). */
    stop(): Promise<void>;
    exportPreview(id: string): Promise<ExportPreview>;
    exportRun(id: string, force: boolean): Promise<{ results: FileResult[]; notes: string[]; card: GameCard }>;
    restorePreview(id: string): Promise<{ count: number; conflicts: string[] }>;
    restoreRun(id: string, force: boolean): Promise<{ results: RestoreResult[]; card: GameCard }>;
    /** Dòng lỗi mã điều khiển chưa xử lý (width = độ rộng dòng đang dùng, để chia câu giống lúc dịch). */
    errors(id: string, width?: number): Promise<ErrorItem[]>;
    /** Lưu bản dịch tự gõ cho 1 đoạn (kiểm tra đủ mã) rồi ghi lại bản dịch. */
    fixError(id: string, width: number | undefined, key: string, translations: string[]): Promise<GameView>;
    /** Giữ bản gốc cho các đoạn (ẩn khỏi danh sách). */
    keepErrors(id: string, width: number | undefined, keys: string[]): Promise<GameView>;
    /** Bỏ mọi lựa chọn "giữ bản gốc" → các đoạn đó quay lại danh sách lỗi. */
    unkeepErrors(id: string, width: number | undefined): Promise<GameView>;
    /** Nhờ AI dịch lại (hỏi trước qua onPrompt). */
    retranslateErrors(id: string, width: number | undefined, keys: string[], maxCost?: number): Promise<{ result: RetranslateResult; view: GameView }>;
    /** Dịch thử: tạo bản thêm "[VI] " cho các file đã chọn rồi chạy thử chép vào game. */
    testPreview(id: string, files: string[]): Promise<TestPreview>;
    /** Chép bản dịch thử vào game. */
    testRun(id: string, force: boolean): Promise<{ results: FileResult[]; notes: string[]; card: GameCard }>;
    glossary(id: string): Promise<GlossaryView>;
    /** Lưu phần glossary người dùng sửa (keep / terms / translate). */
    saveGlossary(id: string, width: number | undefined, g: UserGlossaryInput): Promise<GlossarySaveResult>;
    /** Tên nhân vật + ngôn ngữ nhận diện. */
    actorNames(id: string): Promise<ActorNamesView>;
    /** Gợi ý tên (Romaji / Hán Việt; kanji hỏi cách đọc từ Google miễn phí). */
    suggestNames(names: string[], lang: NameLang): Promise<NameSuggestion[]>;
    /** Lưu tên đã duyệt (gửi đủ cả bảng). */
    saveActorNames(id: string, width: number | undefined, names: Record<string, string>): Promise<GlossarySaveResult>;
    openGlossaryFile(id: string): Promise<void>;
    fontCheck(id: string): Promise<FontCheck>;
    fontFix(id: string, fontPath?: string): Promise<{ family: string; file: string }>;
    fontReset(id: string): Promise<void>;
    pickFontFile(): Promise<string | null>;
    openFolder(id: string): Promise<void>;
  };
  engines: {
    check(): Promise<EngineCheck[]>;
    keys(): Promise<KeyStatus[]>;
    /** Nhập key (hộp thoại đi qua onPrompt). */
    setKey(engine: string): Promise<"saved" | "cancelled" | "unknown-engine">;
  };
  settings(): Promise<SettingsDTO>;
  /** Ghi cài đặt vào config.json (chỉ các mục gửi lên). */
  saveSettings(patch: SettingsPatch): Promise<SettingsDTO>;
  openDataDir(): Promise<void>;
  setTheme(theme: "light" | "dark" | "system"): void;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    onMaximized(cb: (max: boolean) => void): () => void;
  };
  onEvent(cb: (e: AppEvent) => void): () => void;
  onPrompt(cb: (req: PromptRequest) => void): () => void;
  answerPrompt(id: number, value: unknown): void;
  /** Người dùng bấm ✕ khi đang dịch → giao diện hỏi lại. */
  onConfirmQuit(cb: () => void): () => void;
  /** Đồng ý thoát: main dừng việc đang chạy (lưu phần đã xong) rồi đóng. */
  quitAfterStop(): void;
}

declare global {
  interface Window {
    nexa: NexaApi;
  }
}
