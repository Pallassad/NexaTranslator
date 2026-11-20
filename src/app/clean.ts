import { basename, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { dirStats, moveToTrash } from "../core/trash";
import type { AppContext } from "./context";

export interface CleanPlan {
  target: string;
  exists: boolean;
  bytes: number;
  files: number;
}

/**
 * Xem trước việc dọn thư mục output (giữ projects/: memory, glossary, bản gốc, backup).
 * @param root thư mục game; không có → dọn toàn bộ output/.
 */
export function planClean(ctx: AppContext, root?: string): CleanPlan {
  const target = root ? join(ctx.workDir, "output", basename(resolve(root))) : join(ctx.workDir, "output");
  if (!existsSync(target)) return { target, exists: false, bytes: 0, files: 0 };
  return { target, exists: true, ...dirStats(target) };
}

/** Dọn thật (Windows: vào Thùng rác). */
export function runClean(plan: CleanPlan): "trash" | "deleted" {
  return moveToTrash(plan.target);
}
