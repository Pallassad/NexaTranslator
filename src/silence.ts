/**
 * Ẩn cảnh báo "SQLite is an experimental feature" của Node (không ảnh hưởng hoạt động).
 * Các cảnh báo khác vẫn được in ra bình thường.
 * File này phải được import ĐẦU TIÊN trong cli.ts.
 */
process.removeAllListeners("warning");
process.on("warning", w => {
  if (w.name === "ExperimentalWarning" && /SQLite/i.test(w.message)) return;
  console.warn(`${w.name}: ${w.message}`);
});
