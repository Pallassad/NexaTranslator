import "../src/silence"; // ẩn cảnh báo "SQLite is experimental"
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell } from "electron";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createContext, type AppEvent, type Prompter } from "../src/app";
import { ensureConfigFile } from "../src/core/config";
import type { NameLang, PromptRequest, SettingsPatch, UserGlossaryInput } from "../shared/api";
import { Backend, toApiError } from "./backend";
import { EncryptedKeyStore } from "./keystore";
import { assetsDir, buildDir, dataDir } from "./paths";

/**
 * Tiến trình chính của Nexa Translation.
 * Giao diện (ui/) chỉ nói chuyện với đây qua IPC; ở đây gọi lớp src/app/ (dùng chung với CLI).
 */

const DATA = dataDir();
ensureConfigFile(join(DATA, "config.json"));
process.env.NEXA_ASSETS_DIR = assetsDir();
app.setName("Nexa Translation");
// Bản portable: dữ liệu trình duyệt (lựa chọn sáng/tối...) cũng để cạnh exe
app.setPath("userData", join(DATA, ".nexa"));

// nexa-icon://game/<id> → ảnh icon/icon.png của game trong thư viện (chỉ đúng file đó, không gì khác)
protocol.registerSchemesAsPrivileged([{ scheme: "nexa-icon", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let win: BrowserWindow | null = null;
let quitConfirmed = false;

const send = (channel: string, payload?: unknown) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

// ---------------------------------------------------------------- hỏi người dùng qua giao diện
let promptSeq = 0;
const waiting = new Map<number, (value: unknown) => void>();

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

function ask<T>(req: DistributiveOmit<PromptRequest, "id">, fallback: T): Promise<T> {
  if (!win || win.isDestroyed()) return Promise.resolve(fallback);
  const id = ++promptSeq;
  return new Promise<T>(resolve => {
    waiting.set(id, v => resolve(v as T));
    send("prompt:request", { ...req, id });
  });
}

const prompter: Prompter = {
  confirmPaid: offer => ask({ kind: "paid", offer }, false),
  askKey: req => ask({ kind: "key", req }, null),
  confirmSaveKey: engine => ask({ kind: "save-key", engine }, false),
};

ipcMain.on("prompt:answer", (_e, id: number, value: unknown) => {
  waiting.get(id)?.(value);
  waiting.delete(id);
});

/** Hủy mọi câu hỏi đang chờ (đóng cửa sổ, dừng dịch) để lõi không treo. */
function cancelPrompts() {
  for (const resolve of waiting.values()) resolve(null);
  waiting.clear();
}

// ---------------------------------------------------------------- lõi
const keys = new EncryptedKeyStore(DATA);
const ctx = createContext({
  workDir: DATA,
  emit: (e: AppEvent) => send("app:event", e),
  prompt: prompter,
  keyStore: keys,
});
const backend = new Backend(ctx, keys, DATA);

/** Đăng ký 1 hàm cho giao diện gọi; lỗi được đóng gói kèm mã để giao diện hiện đúng hộp thoại. */
function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: toApiError(e) };
    }
  });
}

handle("tools", () => backend.tools());
handle("library:list", (tool: string) => backend.listGames(tool));
handle("library:add", (tool: string, root: string) => backend.addGame(tool, root));
handle("library:remove", (id: string) => backend.removeGame(id));
handle("library:pickFolder", async () => {
  const r = await dialog.showOpenDialog(win!, { title: "Chọn thư mục game", properties: ["openDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});

handle("game:open", (id: string) => backend.openGame(id));
handle("game:setFormat", (id: string, f: string) => backend.setFormat(id, f));
handle("game:estimate", (id: string, opt) => backend.estimate(id, opt));
handle("game:translate", (id: string, opt) => backend.translate(id, opt));
handle("game:stop", async () => {
  cancelPrompts();
  await backend.stopAndWait();
});
handle("game:exportPreview", (id: string) => backend.exportPreview(id));
handle("game:exportRun", (id: string, force: boolean) => backend.exportRun(id, force));
handle("game:restorePreview", (id: string) => backend.restorePreview(id));
handle("game:restoreRun", (id: string, force: boolean) => backend.restoreRun(id, force));
handle("game:errors", (id: string, w?: number) => backend.errors(id, w));
handle("game:fixError", (id: string, w: number | undefined, key: string, tr: string[]) => backend.fixError(id, w, key, tr));
handle("game:keepErrors", (id: string, w: number | undefined, keys: string[]) => backend.keepErrors(id, w, keys));
handle("game:unkeepErrors", (id: string, w?: number) => backend.unkeepErrors(id, w));
handle("game:retranslateErrors", (id: string, w: number | undefined, keys: string[], max?: number) => backend.retranslateErrors(id, w, keys, max));
handle("game:glossary", (id: string) => backend.glossary(id));
handle("game:saveGlossary", (id: string, w: number | undefined, g: UserGlossaryInput) => backend.saveGlossary(id, w, g));
handle("game:actorNames", (id: string) => backend.actorNames(id));
handle("game:suggestNames", (names: string[], lang: NameLang) => backend.suggestNames(names, lang));
handle("game:saveActorNames", (id: string, w: number | undefined, names: Record<string, string>) => backend.saveActorNames(id, w, names));
handle("game:openGlossaryFile", async (id: string) => {
  const err = await shell.openPath(backend.glossaryFile(id));
  if (err) throw new Error(err);
});
handle("game:fontCheck", (id: string) => backend.fontCheck(id));
handle("game:fontFix", (id: string, fontPath?: string) => backend.fontFix(id, fontPath));
handle("game:fontReset", (id: string) => backend.fontReset(id));
handle("game:pickFontFile", async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: "Chọn file font", properties: ["openFile"],
    filters: [{ name: "Font", extensions: ["ttf", "otf", "woff", "woff2"] }],
  });
  return r.canceled ? null : r.filePaths[0];
});
handle("game:openFolder", async (id: string) => {
  const err = await shell.openPath(backend.gameRoot(id));
  if (err) throw new Error(err);
});

handle("engines:check", () => backend.checkEngines());
handle("engines:keys", () => backend.keyStatus());
handle("engines:setKey", (engine: string) => backend.setKey(engine));
handle("settings", () => backend.settings());
handle("settings:save", (patch: SettingsPatch) => backend.saveSettings(patch));
handle("openDataDir", async () => { await shell.openPath(DATA); });

ipcMain.on("theme:set", (_e, theme: "light" | "dark" | "system") => {
  nativeTheme.themeSource = theme;
});

// ---------------------------------------------------------------- cửa sổ
ipcMain.on("win:minimize", () => win?.minimize());
ipcMain.on("win:toggleMaximize", () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
ipcMain.on("win:close", () => win?.close());
ipcMain.on("app:quitAfterStop", async () => {
  quitConfirmed = true;
  cancelPrompts();
  await backend.stopAndWait();     // dừng sau lô đang dịch, phần đã xong đã lưu
  win?.close();
});

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 1040, minHeight: 680,
    frame: false,                         // thanh tiêu đề tự vẽ
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0B0B14" : "#F6F6FA",
    show: false,
    title: "Nexa Translation",
    webPreferences: {
      preload: join(buildDir, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win?.show());
  win.on("maximize", () => send("win:maximized", true));
  win.on("unmaximize", () => send("win:maximized", false));

  // Đang dịch mà bấm ✕ → hỏi lại trong giao diện thay vì đóng ngay
  win.on("close", e => {
    if (backend.busy && !quitConfirmed) {
      e.preventDefault();
      send("app:confirmQuit");
    }
  });
  win.on("closed", () => { win = null; cancelPrompts(); });

  // Link ngoài → mở bằng trình duyệt, không mở trong app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", e => e.preventDefault());

  // Bản đóng gói luôn mở giao diện kèm theo app – không cho biến môi trường trỏ cửa sổ sang trang khác
  const devUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(join(buildDir, "..", "dist", "ui", "index.html"));
}

app.whenReady().then(() => {
  protocol.handle("nexa-icon", req => {
    const id = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ""));
    const icon = backend.iconOf(id);
    return icon ? net.fetch(pathToFileURL(icon).toString()) : new Response("", { status: 404 });
  });
  keys.loadIntoEnv();
  createWindow();
});
app.on("window-all-closed", () => app.quit());
