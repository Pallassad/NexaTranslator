/** Định dạng số, tiền, thời gian kiểu Việt Nam (1.234,5). */
export const fmt = (n: number, d = 0) =>
  n.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });

export const usd = (n: number) => "$" + fmt(n, n > 0 && n < 0.1 ? 3 : 2);

/** Khoảng ước tính (giống Range trong src/core/estimate.ts). */
export interface Range { low: number; high: number }

export const usdRange = ({ low: a, high: b }: Range) =>
  b < 0.01 ? "< $0,01" : `~$${fmt(a, 2)} – ${fmt(b, 2)}`;

export function minutesRange({ low: a, high: b }: Range): string {
  const f = (m: number) => (m < 1 ? "<1 phút" : m < 90 ? `${Math.round(m)} phút` : `${fmt(m / 60, 1)} giờ`);
  return f(a) === f(b) ? `~${f(a)}` : `~${f(a)} – ${f(b)}`;
}

export function duration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} giây`;
  if (s < 3600) return `${Math.floor(s / 60)} phút${s % 60 ? ` ${s % 60} giây` : ""}`;
  return `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`;
}

export function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.round(h / 24)} ngày trước`;
}

/** Tên nhóm file hiển thị (nhóm do bộ đọc trả về). */
export const GROUP_LABEL: Record<string, string> = {
  story: "Thoại", desc: "Tên & mô tả", quest: "Nhiệm vụ", items: "Vật phẩm", skills: "Kỹ năng", npc: "NPC",
  system: "Hệ thống", actors: "Nhân vật", classes: "Nghề nghiệp", enemies: "Kẻ địch", other: "Khác",
};
export const GROUP_ORDER = ["story", "desc", "quest", "items", "skills", "npc", "actors", "classes", "enemies", "system", "other"];
export const groupLabel = (g: string) => GROUP_LABEL[g] ?? g;

/** Tên định dạng dễ hiểu cho người dùng (bộ đọc trả về tên kỹ thuật). */
const FORMAT_LABEL: Record<string, string> = { "rpgm-data": "Dữ liệu JSON", "rpgm-kns-csv": "Bảng CSV (plugin KNS)", "rpgm-rem-loc": "Thư mục loc (www\\loc)", "rpgm-lang-tsv": "Bảng Languages.tsv" };
export const formatLabel = (f: { id: string; label: string }) => FORMAT_LABEL[f.id] ?? f.label;

/** Trạng thái dịch của 1 game. Đang chạy dịch → luôn là "đang dịch". */
export type GameStatus = "running" | "done" | "progress" | "none";
export function gameStatus(g: { id: string; progress?: { translated: number; lines: number; kept: number } }, runningId?: string | null): GameStatus {
  if (runningId === g.id) return "running";
  const p = g.progress;
  if (!p || (p.translated === 0 && !p.kept)) return "none";
  // Dòng giữ bản gốc vì lỗi mã cũng tính là đã xử lý xong
  return p.translated + p.kept >= p.lines ? "done" : "progress";
}

/** Lấy câu thông báo từ lỗi (lỗi từ main là object { message, code }). */
export const errMsg = (e: unknown) =>
  (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));
