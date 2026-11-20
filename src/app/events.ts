import type { Range } from "../core/estimate";

/**
 * Lớp app/ KHÔNG tự in ra màn hình và KHÔNG tự đọc bàn phím.
 *  - Muốn báo gì → phát 1 "sự kiện" (AppEvent) qua ctx.emit.
 *  - Muốn hỏi người dùng → gọi ctx.prompt (Prompter).
 * CLI: in sự kiện ra terminal, hỏi bằng readline.
 * Electron: gửi sự kiện sang cửa sổ (thanh tiến độ, log), hỏi bằng hộp thoại.
 */

/** Tiến độ dịch (gửi sau mỗi lô). */
export interface ProgressEvent {
  type: "progress";
  done: number;
  total: number;
  engine: string;
  /** Chi phí engine đang chạy đã dùng trong lượt này (USD). */
  costUsd: number;
  elapsedMs: number;
  /** Ước tính thời gian còn lại (ms), tính trên tiến độ tổng. */
  etaMs: number;
  /**
   * Tiến độ TỔNG của cả lần dịch (qua mọi giai đoạn, mọi engine).
   * done/total ở trên chỉ là của lượt hiện tại → đặt lại khi sang giai đoạn 2 hoặc đổi engine.
   */
  overallDone: number;
  overallTotal: number;
  phase: "map-names" | "main";
  /** Engine đang chạy là engine trả phí. */
  paid: boolean;
}

export type AppEvent =
  /** Thông báo chung. level "warn" = cảnh báo (vd file lỗi bị bỏ qua, engine bị chặn đang thử lại). */
  | { type: "log"; level: "info" | "warn"; message: string }
  /** Vừa chụp bản sao data gốc của game. */
  | { type: "snapshot"; dir: string }
  /** Bắt đầu dịch. */
  | { type: "translate-start"; engine: string; from: string; to: string; maxChars: number; overallTotal: number; mapNames: number }
  /** Giai đoạn dịch: "map-names" = dịch trước tên khu vực, "main" = phần còn lại. */
  | { type: "phase"; phase: "map-names" | "main"; count: number }
  | ProgressEvent
  /** 1 lượt dịch (1 engine) kết thúc hoặc bị ngắt → CLI xuống dòng sau thanh tiến độ. */
  | { type: "progress-end" }
  /** Engine không dùng tiếp được (bị chặn, hết credit...). */
  | { type: "engine-unavailable"; message: string }
  /** Chuyển sang engine khác (thường là engine trả phí sau khi người dùng đồng ý). */
  | { type: "engine-switch"; engine: string }
  /** Kiểm tra API key vừa nhập. */
  | { type: "key-check"; ok: boolean; message: string }
  /** Đã lưu key (where = nơi lưu: đường dẫn .env hoặc "kho mã hóa của Windows"). */
  | { type: "key-saved"; where: string }
  /** Đã áp font của Font Doctor vào bản xuất. */
  | { type: "font-applied"; file: string };

/** Thông tin để hỏi người dùng có dùng engine trả phí không. */
export interface PaidOffer {
  engine: string;
  model: string;
  /** Số câu / ký tự còn phải dịch. */
  sentences: number;
  chars: number;
  /** Không có giá trong config.json → undefined (không ước tính được). */
  cost?: Range;
  minutes: Range;
  maxCost?: number;
  /**
   * Vì sao hỏi: "blocked" = engine miễn phí bị chặn giữa chừng, "chosen" = người dùng chọn AI từ đầu,
   * "retranslate" = nhờ AI dịch lại dòng lỗi.
   */
  reason: PaidReason;
}

export type PaidReason = "blocked" | "chosen" | "retranslate";

export interface KeyRequest {
  engine: string;
  /** Tên biến môi trường, vd CLAUDE_API_KEY. */
  keyEnv: string;
  /** Lần thử thứ mấy (1, 2, 3). */
  attempt: number;
}

/** Cách hỏi người dùng. CLI và Electron mỗi bên có 1 bản. */
export interface Prompter {
  /** Hỏi có dùng engine trả phí không. */
  confirmPaid(offer: PaidOffer): Promise<boolean>;
  /** Hỏi API key (ẩn ký tự). null hoặc "" = hủy. */
  askKey(req: KeyRequest): Promise<string | null>;
  /** Key dùng được → hỏi có lưu vào .env không. */
  confirmSaveKey(engine: string): Promise<boolean>;
}

/** Prompter không hỏi được ai (vd chạy nền): luôn trả "không". */
export const denyAll: Prompter = {
  confirmPaid: async () => false,
  askKey: async () => null,
  confirmSaveKey: async () => false,
};
