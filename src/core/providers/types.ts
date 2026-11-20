/** Giá USD cho 1 triệu token. */
export interface Pricing { input: number; output: number; }

/** Số token đã dùng (chỉ engine AI có). */
export interface Usage { input: number; output: number; }

export interface TranslationProvider {
  name: string;
  /** true = engine tính tiền → tool phải hỏi người dùng trước khi dùng. */
  paid?: boolean;
  /** Bảng giá (để ước tính / tính chi phí). */
  pricing?: Pricing;
  /** Token đã dùng từ lúc tạo engine. */
  usage?: Usage;
  /**
   * Dịch một lô câu. Kết quả có đúng số phần tử như đầu vào.
   * Phần tử null = engine không dịch câu đó (ví dụ AI từ chối) → tool sẽ thử engine khác.
   */
  translateBatch(texts: string[], from: string, to: string): Promise<(string | null)[]>;
}

/** Chi phí (USD) đã dùng của một engine. */
export function costOf(p: TranslationProvider): number {
  if (!p.usage || !p.pricing) return 0;
  return (p.usage.input * p.pricing.input + p.usage.output * p.pricing.output) / 1_000_000;
}
