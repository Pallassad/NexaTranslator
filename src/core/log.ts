/**
 * Nơi lõi gửi các thông báo phụ (thử lại, đổi endpoint, đổi engine...) thay cho console.warn.
 *
 * Lõi KHÔNG tự in ra màn hình: CLI in ra terminal, Electron hiện trong giao diện.
 * Mặc định (khi chưa ai đăng ký, vd trong test) → in bằng console.warn như trước.
 */
export type LogSink = (message: string) => void;

let sink: LogSink = message => console.warn(message);

/** Đăng ký nơi nhận thông báo. Trả về hàm để khôi phục nơi nhận cũ. */
export function setLogSink(fn: LogSink): () => void {
  const prev = sink;
  sink = fn;
  return () => { sink = prev; };
}

/** Gửi 1 thông báo cảnh báo (không có ký tự xuống dòng ở đầu). */
export function logWarn(message: string): void {
  sink(message);
}
