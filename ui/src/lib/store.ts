import { useSyncExternalStore } from "react";
import type {
  ApiError, ErrorItem, EstimateDTO, ExportPreview, GameCard, GameView, PaidOffer, ToolDTO, TranslateEngine, TranslateResult,
} from "../../../shared/api";

/**
 * Trạng thái chung của cả app (1 chỗ duy nhất).
 * Đặt ở đây chứ không trong từng màn hình → chuyển tab Glossary rồi quay lại tab Dịch
 * vẫn còn lựa chọn file, tiến độ đang chạy, nhật ký.
 */

export type Screen = "tools" | "library" | "translate" | "glossary" | "font" | "settings";

export interface LogLine {
  t: number;
  level: "info" | "warn" | "error" | "success";
  text: string;
}

export interface RunState {
  gameId: string;
  engine: string;
  phase: "map-names" | "main";
  mapNames: number;
  overallDone: number;
  overallTotal: number;
  costUsd: number;
  paid: boolean;
  etaMs: number;
  startedAt: number;
  /** Đã bấm Dừng, đang chờ lô hiện tại xong. */
  stopping: boolean;
  maxCost?: number;
}

/** Câu hỏi "dùng engine trả phí?" – để riêng, không bị hộp thoại khác (vd "Thoát?") ghi đè. */
export interface PaidDialogState { promptId: number; offer: PaidOffer }

export type DialogState =
  | { kind: "export"; gameId: string; preview: ExportPreview; test?: { files: number; lines: number } }
  | { kind: "restore"; gameId: string; count: number; conflicts: string[] }
  | { kind: "source-invalid"; problem: string; gameId: string }
  | { kind: "not-game"; message: string; guess?: string | null; path: string }
  | { kind: "remove"; game: GameCard }
  | { kind: "info"; game: GameCard }
  | { kind: "font-fix"; fontPath?: string }
  | { kind: "quit" };

export interface KeyDialogState {
  engine: string;
  promptId: number | null;
  attempt: number;
  checking: boolean;
  status: { ok: boolean; message: string } | null;
  save: boolean;
}

export interface Toast {
  id: number;
  type: "success" | "info" | "warning" | "error";
  title: string;
  text?: string;
}

export interface AppState {
  screen: Screen;
  tools: ToolDTO[];
  tool: ToolDTO | null;
  /** Game đang mở + dữ liệu tab Dịch. */
  gameId: string | null;
  view: GameView | null;
  viewLoading: boolean;
  viewError: ApiError | null;
  sel: Set<string>;
  collapsed: Set<string>;
  width: number | null;
  maxCost: string;
  /** Engine dịch từ đầu (chỉ cho lần dịch này, mở lại app → về Google cho an toàn chi phí). */
  engine: TranslateEngine;
  stage: "idle" | "estimate" | "run" | "result" | "errors";
  /** Danh sách dòng lỗi (màn "errors"); null = chưa tải. */
  errors: ErrorItem[] | null;
  estimate: EstimateDTO | null;
  estimating: boolean;
  run: RunState | null;
  result: TranslateResult | null;
  log: LogLine[];
  dialog: DialogState | null;
  paid: PaidDialogState | null;
  keyDialog: KeyDialogState | null;
  toasts: Toast[];
  /** Thư viện (để vẽ lại sau khi thêm/xóa/dịch). */
  libVersion: number;
}

const initial: AppState = {
  screen: "tools", tools: [], tool: null,
  gameId: null, view: null, viewLoading: false, viewError: null,
  sel: new Set(), collapsed: new Set(), width: null, maxCost: "1.00", engine: "google",
  stage: "idle", errors: null, estimate: null, estimating: false, run: null, result: null,
  log: [], dialog: null, paid: null, keyDialog: null, toasts: [], libVersion: 0,
};

let state = initial;
const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  listeners.forEach(l => l());
}

export function useApp(): AppState {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}

// ---------------------------------------------------------------- tiện ích
let toastSeq = 0;
export function toast(type: Toast["type"], title: string, text?: string) {
  const id = ++toastSeq;
  setState(s => ({ toasts: [...s.toasts, { id, type, title, text }] }));
  setTimeout(() => setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), type === "error" ? 7000 : 4500);
}

export function addLog(level: LogLine["level"], text: string) {
  setState(s => ({ log: [...s.log.slice(-400), { t: Date.now(), level, text }] }));
}

export const go = (screen: Screen) => setState({ screen });
