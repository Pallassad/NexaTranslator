import { fmtDuration, fmtMinutes, fmtNum, fmtUsd } from "../core/estimate";
import type { AppEvent, Prompter } from "../app/events";
import { askSecret, confirm, interactive } from "../prompt";

/**
 * Bản "terminal" của sự kiện + hỏi người dùng.
 * Electron sẽ có bản riêng (gửi sự kiện sang cửa sổ, hỏi bằng hộp thoại).
 */

/** Đang in dở thanh tiến độ (dòng dùng \r) → thông báo khác phải xuống dòng trước. */
let progressLine = false;

const breakProgress = () => {
  if (progressLine) { process.stdout.write("\n"); progressLine = false; }
};

export function printEvent(e: AppEvent): void {
  switch (e.type) {
    case "progress": {
      const pct = Math.floor((e.done / e.total) * 100);
      const cost = e.costUsd > 0 ? ` – đã dùng ~$${e.costUsd.toFixed(3)}` : "";
      process.stdout.write(
        `\r  Đang dịch: ${fmtNum(e.done)}/${fmtNum(e.total)} câu (${pct}%) – ${e.engine} – còn ~${fmtDuration(e.etaMs)}${cost}   `);
      progressLine = true;
      return;
    }
    case "progress-end":
      if (progressLine) breakProgress();
      return;
  }
  breakProgress();
  switch (e.type) {
    case "log":
      if (e.level === "warn") console.warn(e.message);
      else console.log(e.message);
      return;
    case "snapshot":
      console.log(`📦 Đã lưu bản sao gốc vào ${e.dir} (các lần sau tool đọc chữ gốc từ đây)\n`);
      return;
    case "translate-start":
      console.log(`▶ Bắt đầu dịch bằng ${e.engine} | ${e.from} → ${e.to} | tối đa ${e.maxChars} ký tự/dòng\n`);
      return;
    case "phase":
      console.log(e.phase === "map-names"
        ? `  Giai đoạn 1: dịch trước ${e.count} tên khu vực để dùng thống nhất trong thoại`
        : `  Giai đoạn 2: dịch phần còn lại\n`);
      return;
    case "engine-unavailable":
      console.warn(`⛔ ${e.message}`);
      return;
    case "engine-switch":
      console.log(`\n▶ Dịch tiếp bằng ${e.engine}\n`);
      return;
    case "key-check":
      if (e.ok) console.log(`  ✅ ${e.message}`);
      else console.warn(`  ❌ ${e.message}`);
      return;
    case "key-saved":
      console.log(`  Đã lưu vào ${e.where} (file này không được đưa lên Git).`);
      return;
    case "font-applied":
      console.log(`🔤 Đã áp font ${e.file} (Font Doctor) vào bản xuất`);
      return;
  }
}

/** @param autoYes --yes: tự đồng ý dùng engine trả phí. */
export function terminalPrompter(autoYes: boolean): Prompter {
  return {
    async confirmPaid(o) {
      breakProgress();
      console.log(`\n💡 Còn ${fmtNum(o.sentences)} câu (~${fmtNum(o.chars)} ký tự) chưa dịch.`);
      console.log(`   Engine trả phí: ${o.model}` + (o.cost
        ? ` – ước tính ${fmtUsd(o.cost)}, ${fmtMinutes(o.minutes)}`
        : " – (chưa có giá trong config.json → không ước tính được chi phí)"));
      if (o.maxCost !== undefined) console.log(`   Giới hạn chi phí lần này: $${o.maxCost}`);
      if (autoYes) return true;
      if (!interactive) {
        console.log("   (Không chạy trong terminal → không hỏi được. Thêm --yes để tự đồng ý.)");
        return false;
      }
      return confirm(`   Dùng ${o.model} (tính tiền vào tài khoản của bạn) để ${o.reason === "blocked" ? "dịch tiếp" : "dịch"}?`);
    },
    async askKey(req) {
      if (!interactive) return null;
      return askSecret(`🔑 Dán API key cho ${req.engine} (Enter để hủy): `);
    },
    confirmSaveKey: () => confirm("  Lưu key vào file .env để lần sau khỏi nhập?"),
  };
}
