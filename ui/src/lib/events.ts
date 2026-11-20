import type { AppEvent } from "../../../shared/api";
import { addLog, getState, setState, toast } from "./store";

/** Sự kiện từ lõi (qua main) → cập nhật trạng thái + nhật ký. */
export function onAppEvent(e: AppEvent) {
  switch (e.type) {
    case "log":
      addLog(e.level === "warn" ? (e.message.startsWith("⛔") ? "error" : "warn") : "info", e.message.replace(/^[⚠ℹ⛔↪]\s*/u, ""));
      return;
    case "snapshot":
      addLog("info", "Đã lưu bản gốc của game để dịch an toàn");
      return;
    case "translate-start":
      setState(s => (s.run ? { run: { ...s.run, engine: e.engine, overallTotal: e.overallTotal, mapNames: e.mapNames, phase: e.mapNames ? "map-names" : "main" } } : {}));
      addLog("info", `Bắt đầu dịch bằng ${e.engine} – tối đa ${e.maxChars} ký tự/dòng`);
      return;
    case "phase":
      setState(s => (s.run ? { run: { ...s.run, phase: e.phase } } : {}));
      addLog("info", e.phase === "map-names"
        ? `Giai đoạn 1: dịch trước ${e.count} tên khu vực để dùng thống nhất trong thoại`
        : "Giai đoạn 2: dịch phần còn lại");
      return;
    case "progress":
      setState(s => (s.run ? {
        run: {
          ...s.run, engine: e.engine, phase: e.phase, overallDone: e.overallDone, overallTotal: e.overallTotal,
          etaMs: e.etaMs, costUsd: e.costUsd, paid: e.paid,
        },
      } : {}));
      return;
    case "progress-end":
      return;
    case "engine-unavailable":
      addLog("error", e.message);
      return;
    case "engine-switch":
      setState(s => (s.run ? { run: { ...s.run, engine: e.engine, costUsd: 0 } } : {}));
      addLog("success", `Dịch tiếp bằng ${e.engine}`);
      return;
    case "key-check": {
      const kd = getState().keyDialog;
      if (kd) setState({ keyDialog: { ...kd, checking: false, status: { ok: e.ok, message: e.message } } });
      addLog(e.ok ? "success" : "error", e.ok ? "API key dùng được" : `API key không dùng được: ${e.message}`);
      return;
    }
    case "key-saved":
      addLog("success", `Đã lưu API key vào ${e.where}`);
      toast("success", "Đã lưu API key", `Lưu trong ${e.where}. Key không hiện trong nhật ký hay màn hình cài đặt.`);
      setTimeout(() => setState({ keyDialog: null }), 700);
      return;
    case "font-applied":
      addLog("info", `Đã áp font ${e.file} (Font Doctor) vào bản dịch`);
      return;
  }
}
