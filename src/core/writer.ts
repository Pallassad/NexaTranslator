import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Entry } from "./types";

/** Đọc JSON, tự bỏ BOM nếu file gốc có (tránh lỗi "Unexpected token"). */
export function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}

/** Ghi JSON dạng UTF-8 KHÔNG BOM (Node mặc định không thêm BOM). */
export function writeJson(path: string, data: unknown, pretty = false) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), "utf8");
}

function setByPath(obj: any, path: (string | number)[], value: string) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    cur = cur?.[path[i]];
    if (cur == null) throw new Error(`Đường dẫn không tồn tại: ${path.join(".")}`);
  }
  const last = path[path.length - 1];
  if (typeof cur[last] !== "string") {
    throw new Error(`Vị trí ${path.join(".")} không phải chuỗi – dữ liệu có thể đã thay đổi`);
  }
  cur[last] = value;
}

/**
 * Ghi bản dịch vào dữ liệu. Dòng chưa có target thì giữ nguyên text gốc.
 * Chỉ sửa đúng các vị trí đã trích xuất, phần còn lại không đụng tới.
 */
export function applyEntries<T>(data: T, entries: Entry[]): T {
  for (const e of entries) setByPath(data, e.path, e.target ?? e.source);
  return data;
}
