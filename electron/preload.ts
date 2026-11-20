import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ApiError, NexaApi } from "../shared/api";

/**
 * Cầu nối an toàn: giao diện chỉ thấy đúng các hàm trong window.nexa,
 * không có require, không có fs, không đọc được key.
 */

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r.ok) return r.value as T;
  // Error đi qua contextBridge bị mất thuộc tính riêng (code, guess) → ném object thường { message, code, guess }
  throw r.error as ApiError;
}

function listen<T>(channel: string, cb: (v: T) => void): () => void {
  const fn = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

const api: NexaApi = {
  tools: () => call("tools"),
  library: {
    list: tool => call("library:list", tool),
    add: (tool, root) => call("library:add", tool, root),
    remove: id => call("library:remove", id),
    pickFolder: () => call("library:pickFolder"),
    pathOf: file => webUtils.getPathForFile(file),
  },
  game: {
    open: id => call("game:open", id),
    setFormat: (id, f) => call("game:setFormat", id, f),
    estimate: (id, opt) => call("game:estimate", id, opt),
    translate: (id, opt) => call("game:translate", id, opt),
    stop: () => call("game:stop"),
    exportPreview: id => call("game:exportPreview", id),
    exportRun: (id, force) => call("game:exportRun", id, force),
    restorePreview: id => call("game:restorePreview", id),
    restoreRun: (id, force) => call("game:restoreRun", id, force),
    errors: (id, w) => call("game:errors", id, w),
    fixError: (id, w, key, tr) => call("game:fixError", id, w, key, tr),
    keepErrors: (id, w, keys) => call("game:keepErrors", id, w, keys),
    unkeepErrors: (id, w) => call("game:unkeepErrors", id, w),
    retranslateErrors: (id, w, keys, max) => call("game:retranslateErrors", id, w, keys, max),
    glossary: id => call("game:glossary", id),
    saveGlossary: (id, w, g) => call("game:saveGlossary", id, w, g),
    actorNames: id => call("game:actorNames", id),
    suggestNames: (names, lang) => call("game:suggestNames", names, lang),
    saveActorNames: (id, w, names) => call("game:saveActorNames", id, w, names),
    openGlossaryFile: id => call("game:openGlossaryFile", id),
    fontCheck: id => call("game:fontCheck", id),
    fontFix: (id, p) => call("game:fontFix", id, p),
    fontReset: id => call("game:fontReset", id),
    pickFontFile: () => call("game:pickFontFile"),
    openFolder: id => call("game:openFolder", id),
  },
  engines: {
    check: () => call("engines:check"),
    keys: () => call("engines:keys"),
    setKey: engine => call("engines:setKey", engine),
  },
  settings: () => call("settings"),
  saveSettings: patch => call("settings:save", patch),
  openDataDir: () => call("openDataDir"),
  setTheme: theme => ipcRenderer.send("theme:set", theme),
  window: {
    minimize: () => ipcRenderer.send("win:minimize"),
    toggleMaximize: () => ipcRenderer.send("win:toggleMaximize"),
    close: () => ipcRenderer.send("win:close"),
    onMaximized: cb => listen("win:maximized", cb),
  },
  onEvent: cb => listen("app:event", cb),
  onPrompt: cb => listen("prompt:request", cb),
  answerPrompt: (id, value) => ipcRenderer.send("prompt:answer", id, value),
  onConfirmQuit: cb => listen("app:confirmQuit", () => cb()),
  quitAfterStop: () => ipcRenderer.send("app:quitAfterStop"),
};

contextBridge.exposeInMainWorld("nexa", api);
