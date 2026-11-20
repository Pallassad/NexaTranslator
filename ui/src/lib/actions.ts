import type { ApiError, GameView, PromptRequest } from "../../../shared/api";
import { errMsg, formatLabel } from "./format";
import { addLog, getState, setState, toast } from "./store";

/**
 * Các thao tác của người dùng: gọi window.nexa rồi cập nhật trạng thái.
 * Tách khỏi component để component chỉ lo vẽ.
 */
const api = () => window.nexa;

/** Chọn mặc định: mọi file trừ file tùy chọn; nhóm thoại dài thì thu gọn. */
function defaultSelection(view: GameView) {
  const sel = new Set(view.files.filter(f => !f.optional).map(f => f.name));
  const collapsed = new Set<string>();
  const story = view.files.filter(f => f.group === "story").length;
  if (story > 12) collapsed.add("story");
  return { sel, collapsed };
}

export async function openGame(id: string) {
  const s = getState();
  if (s.run && s.gameId !== id) {
    toast("warning", "Đang dịch game khác", "Dừng việc dịch hiện tại trước khi mở game khác.");
    return;
  }
  if (s.gameId === id && s.view) { setState({ screen: "translate" }); return; }
  setState({
    gameId: id, view: null, viewLoading: true, viewError: null, screen: "translate",
    stage: "idle", errors: null, estimate: null, result: null, width: null, log: [],
  });
  try {
    const view = await api().game.open(id);
    setState({ view, viewLoading: false, ...defaultSelection(view) });
    addLog("info", `Đã mở ${view.card.name} (${formatLabel(view.format)})`);
  } catch (e) {
    const err = e as ApiError;
    setState({ viewLoading: false, viewError: err });
    if (err.code === "source-invalid") setState({ dialog: { kind: "source-invalid", problem: err.message, gameId: id } });
  }
}

/** Đọc lại danh sách file (sau khi dịch / đổi định dạng) – giữ lựa chọn cũ nếu còn. */
export function applyView(view: GameView, keepSelection = true) {
  setState(s => {
    if (!keepSelection) return { view, ...defaultSelection(view) };
    const names = new Set(view.files.map(f => f.name));
    return { view, sel: new Set([...s.sel].filter(n => names.has(n))) };
  });
}

export async function setFormat(format: string) {
  const { gameId } = getState();
  if (!gameId) return;
  setState({ viewLoading: true, stage: "idle", estimate: null });
  try {
    const view = await api().game.setFormat(gameId, format);
    setState({ viewLoading: false });
    applyView(view, false);
    addLog("info", `Đổi định dạng sang ${formatLabel(view.format)}`);
  } catch (e) {
    setState({ viewLoading: false });
    toast("error", "Không đổi được định dạng", errMsg(e));
  }
}

const optsOf = () => {
  const s = getState();
  const cost = parseFloat(s.maxCost.replace(",", "."));
  return {
    files: [...s.sel], width: s.width ?? undefined, maxCost: Number.isFinite(cost) && cost > 0 ? cost : undefined, engine: s.engine,
  };
};

export async function estimate() {
  const { gameId } = getState();
  if (!gameId) return;
  setState({ estimating: true });
  try {
    const est = await api().game.estimate(gameId, optsOf());
    setState({ estimate: est, stage: "estimate", estimating: false });
    addLog("info", `Ước tính: cần dịch ${est.summary.pending.toLocaleString("vi-VN")} câu`);
  } catch (e) {
    setState({ estimating: false });
    handleError(e, "Không ước tính được");
  }
}

export async function translate() {
  const { gameId } = getState();
  if (!gameId) return;
  const opt = optsOf();
  setState({
    stage: "run", result: null, errors: null,
    run: {
      gameId, engine: "", phase: "main", mapNames: 0, overallDone: 0, overallTotal: 0, costUsd: 0, paid: false,
      etaMs: 0, startedAt: Date.now(), stopping: false, maxCost: opt.maxCost,
    },
  });
  try {
    const { result, view } = await api().game.translate(gameId, opt);
    setState({ run: null, result, stage: result.status === "cancelled" ? "idle" : "result" });
    applyView(view);
    setState(s => ({ libVersion: s.libVersion + 1 }));
    if (result.status === "cancelled") {
      addLog("warn", "Đã hủy: không dùng engine trả phí");
      toast("info", "Chưa dịch câu nào", "Bạn đã không đồng ý dùng engine trả phí.");
    } else {
      addLog(result.status === "done" ? "success" : "warn",
        result.status === "done" ? `Đã dịch xong – ghi ${result.files.length} file vào bản dịch` : `Đã dừng: ${result.stopReason}`);
      if (getState().screen !== "translate") {
        toast(result.status === "done" ? "success" : "warning",
          result.status === "done" ? "Dịch xong" : "Đã dừng dịch", result.stopReason ?? "Mở tab Dịch để xem kết quả.");
      }
    }
  } catch (e) {
    setState({ run: null, stage: "idle" });
    addLog("error", `Lỗi khi dịch: ${errMsg(e)}`);
    handleError(e, "Dịch bị lỗi");
  }
}

export async function stop() {
  // Main hủy luôn các câu hỏi đang chờ (trả phí, key) → đóng các hộp thoại đó
  setState(s => ({ paid: null, keyDialog: null, ...(s.run ? { run: { ...s.run, stopping: true } } : {}) }));
  addLog("info", "Đã yêu cầu dừng – chờ lô đang dịch xong");
  await api().game.stop();
}

export async function exportPreview() {
  const { gameId } = getState();
  if (!gameId) return;
  try {
    const preview = await api().game.exportPreview(gameId);
    setState({ dialog: { kind: "export", gameId, preview } });
  } catch (e) {
    handleError(e, "Không chép vào game được");
  }
}

export async function exportRun(force: boolean) {
  const d = getState().dialog;
  if (d?.kind !== "export") return;
  setState({ dialog: null });
  try {
    const r = await api().game.exportRun(d.gameId, force);
    const written = r.results.filter(x => x.written).length;
    const skipped = r.results.filter(x => x.status === "conflict" && !x.written).length;
    addLog("success", `Đã chép ${written} file vào game${skipped ? `, bỏ qua ${skipped} file xung đột` : ""}`);
    toast("success", written ? `Đã chép ${written} file vào game` : "Không có file nào cần chép",
      skipped ? `${skipped} file xung đột được giữ nguyên.` : force && r.results.some(x => x.backup) ? "Bản cũ của file bị ghi đè đã được sao lưu." : undefined);
    for (const n of r.notes) setTimeout(() => toast("info", "Nhớ làm trong game", n), 300);
    refreshCard(r.card);
  } catch (e) {
    handleError(e, "Chép vào game bị lỗi");
  }
}

export async function restorePreview() {
  const { gameId } = getState();
  if (!gameId) return;
  try {
    const r = await api().game.restorePreview(gameId);
    setState({ dialog: { kind: "restore", gameId, ...r } });
  } catch (e) {
    handleError(e, "Không khôi phục được");
  }
}

export async function restoreRun(force: boolean) {
  const d = getState().dialog;
  if (d?.kind !== "restore") return;
  setState({ dialog: null });
  try {
    const r = await api().game.restoreRun(d.gameId, force);
    const n = r.results.filter(x => x.status === "restored").length;
    addLog("success", `Đã khôi phục ${n} file về bản gốc`);
    toast("success", "Đã khôi phục game về bản gốc", "Bản dịch vẫn còn, chép lại bất cứ lúc nào.");
    refreshCard(r.card);
  } catch (e) {
    handleError(e, "Khôi phục bị lỗi");
  }
}

function refreshCard(card: GameView["card"]) {
  setState(s => ({ view: s.view ? { ...s.view, card } : s.view, libVersion: s.libVersion + 1 }));
}

/** Lỗi chung: hiện hộp thoại riêng cho lỗi "không phải bản gốc", còn lại là thông báo. */
export function handleError(e: unknown, title: string) {
  const err = e as ApiError;
  if (err?.code === "source-invalid") {
    setState({ dialog: { kind: "source-invalid", problem: err.message, gameId: getState().gameId ?? "" } });
    return;
  }
  toast(err?.code === "busy" ? "warning" : "error", title, errMsg(e));
}

// ---------------------------------------------------------------- câu hỏi từ lõi
export function onPrompt(req: PromptRequest) {
  if (req.kind === "paid") {
    setState({ paid: { promptId: req.id, offer: req.offer } });
  } else if (req.kind === "key") {
    setState(s => ({
      keyDialog: {
        engine: req.req.engine, promptId: req.id, attempt: req.req.attempt, checking: false,
        status: s.keyDialog?.status ?? null, save: s.keyDialog?.save ?? true,
      },
    }));
  } else if (req.kind === "save-key") {
    const kd = getState().keyDialog;
    api().answerPrompt(req.id, kd?.save ?? false);
    if (!kd?.save) {
      toast("success", "Key dùng được", "Chỉ dùng cho lần này, không lưu lại.");
      setTimeout(() => setState({ keyDialog: null }), 900);
    }
  }
}

export function answerPaid(yes: boolean) {
  const d = getState().paid;
  if (!d) return;
  api().answerPrompt(d.promptId, yes);
  setState({ paid: null });
  if (!yes) addLog("warn", "Không dùng engine trả phí");
}

export function submitKey(key: string) {
  const kd = getState().keyDialog;
  if (!kd?.promptId) return;
  api().answerPrompt(kd.promptId, key);
  setState({ keyDialog: { ...kd, promptId: null, checking: true, status: null } });
}

export function cancelKey() {
  const kd = getState().keyDialog;
  if (kd?.promptId) api().answerPrompt(kd.promptId, null);
  setState({ keyDialog: null });
}
