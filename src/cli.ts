import "./silence"; // phải đứng đầu: ẩn cảnh báo SQLite experimental
import { dirname } from "node:path";
import { ENGINE_NAMES, KEY_ENV } from "./core/config";
import { checkGoogle } from "./core/providers/google";
import { fmtDuration, fmtMinutes, fmtNum, fmtUsd } from "./core/estimate";
import { fmtBytes } from "./core/trash";
import type { FileResult, RestoreResult } from "./core/exporter";
import { ADAPTERS } from "./formats/registry";
import { confirm, interactive } from "./prompt";
import {
  createContext, openGame, prepareTranslation, estimateRows, glossaryView, runTranslate, fileStatus, fileComplete,
  exportGame, restoreGameFiles, fontCheck, fontFix, fontReset, extractOrMark, planClean, runClean,
  checkEngines, setKey, type AppContext, type GameSession, type PlanSummary, type TranslateResult,
} from "./app";
import { printEvent, terminalPrompter } from "./cli/terminal";

/**
 * CLI: chỉ đọc tham số, gọi lớp app/ và IN kết quả ra terminal.
 * Mọi logic nằm trong src/app/ (dùng chung với Electron).
 */

const USAGE = `Cách dùng:
  npm run dev -- scan      "<thư mục game>"              Nhận diện game: định dạng nào, file nào có chữ
  npm run dev -- extract   "<thư mục game>"              Trích xuất text + kiểm tra ghi lại an toàn
  npm run dev -- mark      "<thư mục game>"              Tạo bản test: thêm "[VI] " vào mọi dòng
  npm run dev -- estimate  "<thư mục game>" [--files]    Thống kê số chữ, ước tính chi phí / thời gian (không dịch)
  npm run dev -- translate "<thư mục game>" [tùy chọn]   Dịch thật
  npm run dev -- glossary  "<thư mục game>"              Xem / sửa glossary: tên giữ nguyên, thuật ngữ dịch cố định
  npm run dev -- export    "<thư mục game>" [--dry-run] Chép bản dịch vào game (tự kiểm tra, không ghi đè file lạ)
  npm run dev -- restore   "<thư mục game>"              Đưa game về bản gốc
  npm run dev -- font      "<thư mục game>" [--fix | --reset] [--font file.ttf]
                                                         Kiểm tra font có đủ chữ tiếng Việt; --fix đổi sang font tiếng Việt
  npm run dev -- clean     "<thư mục game>" | --all      Dọn thư mục output (vào Thùng rác), giữ memory/glossary
  npm run dev -- set-key   claude                        Nhập API key (ẩn khi gõ), kiểm tra và lưu vào .env
  npm run dev -- check-engines [--engine a,b]            Kiểm tra engine nào đang dùng được
  npm run dev -- check-google                            Kiểm tra riêng các cách gọi Google

Tùy chọn cho translate:
  --files Map007.json,Items.json   Chỉ dịch các file này (mặc định: tất cả)
  --engine google | claude | claude-sonnet ...   Engine dùng (mặc định: theo config.json)
                                   Có: ${ENGINE_NAMES.join(", ")}
  --max-cost 0.5                   Dừng khi engine trả phí dùng quá 0,5 USD (trong lần chạy này)
  --yes                            Tự đồng ý dùng engine trả phí (không hỏi)
  --from auto  --to vi             Ngôn ngữ gốc / đích (mặc định theo config.json)
  --width 50                       Số ký tự tối đa mỗi dòng thoại (mặc định: tự đo từ game)
  --delay 1000                     Nghỉ giữa các lần gọi Google, mili giây

Tùy chọn chung:
  --format rpgm-data               Chọn định dạng khi game có nhiều loại chữ (xem bằng lệnh scan)
                                   Có: ${ADAPTERS.map(a => a.id).join(", ")}
  --refresh-source                 Chụp lại bản sao data gốc từ game (chỉ dùng khi data game đang là bản GỐC)

Engine miễn phí (Google) bị chặn → tool HỎI trước khi chuyển sang AI trả phí (config.json → paidEngine).`;

/** Các tùy chọn không cần giá trị đi kèm. */
const BOOL_FLAGS = new Set(["refresh-source", "yes", "force", "dry-run", "all", "fix", "reset"]);

// ---- Đọc tham số ----
const argv = process.argv.slice(2);
const cmd = argv[0];
const flags: Record<string, string> = {};
const positional: string[] = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    const name = argv[i].slice(2);
    flags[name] = BOOL_FLAGS.has(name) ? "true" : argv[++i] ?? "";
  } else positional.push(argv[i]);
}
// Ghép lại: phòng trường hợp đường dẫn có dấu cách bị shell cắt làm nhiều phần
const root = positional.join(" ").trim().replace(/^"+|"+$/g, "");
const flag = (name: string) => flags[name] === "true";
const list = (name: string) => flags[name]?.split(",").map(s => s.trim()).filter(Boolean);

const ctx: AppContext = createContext({
  emit: printEvent,
  prompt: terminalPrompter(flag("yes")),
  delayMs: flags.delay ? Number(flags.delay) : undefined,
});

// ---------------------------------------------------------------------------
// Lệnh theo game
// ---------------------------------------------------------------------------

async function main() {
  const session = openGame(ctx, root, { format: flags.format, refreshSource: flag("refresh-source") });

  if (cmd === "scan") return printScan(session);

  const { fmt } = session;
  console.log(`Định dạng: ${fmt.label}` + (session.otherFormats.length
    ? `   (game còn có: ${session.otherFormats.map(f => f.id).join(", ")} → chọn bằng --format)` : ""));
  for (const line of fmt.info) console.log(line);
  console.log();

  switch (cmd) {
    case "export": {
      const r = exportGame(session, { force: flag("force"), dryRun: flag("dry-run") });
      printExport(r.results, r.dryRun);
      for (const n of r.notes) console.log(`\nℹ ${n}`);
      return;
    }
    case "restore": {
      const r = restoreGameFiles(session, { force: flag("force"), dryRun: flag("dry-run") });
      printRestore(r.results, r.dryRun);
      return;
    }
    case "font":
      return fontCommand(session);
    case "extract":
    case "mark": {
      const r = extractOrMark(session, cmd);
      console.table(r.rows.map(x => ({ file: x.file, lines: x.lines, roundtrip: x.roundtripOk ? "OK" : "❌ LỆCH" })));
      console.log(`Tổng: ${r.totalLines} dòng text từ ${r.rows.length} file`);
      console.log(cmd === "extract" ? `Đã lưu danh sách text vào ${r.outPath}` : `Đã tạo bản test trong ${r.outPath}`);
      if (r.rows.some(x => !x.roundtripOk)) process.exitCode = 2;
      return;
    }
    case "translate":
    case "estimate":
    case "glossary":
      return translateCommand(session);
    default:
      console.error(`Lệnh không hợp lệ: ${cmd}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

async function translateCommand(session: GameSession) {
  const plan = prepareTranslation(ctx, session, {
    files: list("files"), from: flags.from, to: flags.to, width: Number(flags.width) || undefined,
  });
  try {
    if (cmd === "glossary") return printGlossary(plan);

    printSummary(plan.summary());
    const g = glossaryView(plan);
    console.log(`📘 Glossary: giữ nguyên ${g.keep.length} tên · ${g.userTermCount} thuật ngữ của bạn · ` +
      `${g.mapSyncCount} tên khu vực đồng bộ vào thoại  (xem: npm run dev -- glossary "<game>")\n`);

    if (cmd === "estimate") return printEstimates(plan.pending());

    // Ctrl+C lần 1: dừng êm sau lô đang dịch (vẫn xuất phần đã dịch). Lần 2: thoát ngay.
    const stop = new AbortController();
    const onSigint = () => {
      if (stop.signal.aborted) process.exit(130);
      console.log("\n⏸ Đang dừng sau lô hiện tại... (Ctrl+C lần nữa để thoát ngay)");
      stop.abort();
    };
    process.on("SIGINT", onSigint);
    try {
      const r = await runTranslate(ctx, session, plan, {
        engines: list("engine"),
        maxCost: flags["max-cost"] ? Number(flags["max-cost"]) : undefined,
        signal: stop.signal,
      });
      printTranslateResult(session, r);
    } finally {
      process.off("SIGINT", onSigint);
    }
  } finally {
    plan.close();
  }
}

function fontCommand(session: GameSession) {
  if (flag("reset")) {
    fontReset(session);
    console.log("✅ Đã bỏ lựa chọn font – game dùng lại font gốc.");
    console.log(`→ Chạy: npm run dev -- export "<thư mục game>"   (hoặc restore để về bản gốc hoàn toàn)`);
    return;
  }
  if (flag("fix")) {
    const r = fontFix(session, flags.font);
    console.log(`✅ Đã chọn font ${r.family} (${r.file}) cho game này.`);
    console.log(`   Từ giờ mỗi lần translate, tool tự áp font này vào bản xuất.`);
    console.log(`→ Chạy: npm run dev -- export "<thư mục game>"   để chép vào game`);
    return;
  }
  const c = fontCheck(session);
  console.log(`🔤 Font chính của game: ${c.info.mainFile ?? "(không khai báo)"}` +
    (c.engine === "MZ" ? "  (data/System.json)" : "  (fonts/gamefont.css)"));
  if (!c.main) {
    console.log("   ⚠ Không tìm thấy file font này trong thư mục fonts/ → game đang dùng font của hệ thống.");
    console.log(`   Nếu chữ tiếng Việt hiển thị lỗi: npm run dev -- font "<thư mục game>" --fix`);
  } else if (c.main.missing.length === 0) {
    console.log(`   ✅ ${c.main.family}: đủ ${c.checkedChars} ký tự cần dùng (tiếng Việt + bản dịch). Không cần đổi font.`);
  } else {
    const m = c.main.missing;
    console.log(`   ⚠ ${c.main.family}: thiếu ${m.length} ký tự: ${m.slice(0, 30).join(" ")}${m.length > 30 ? " …" : ""}`);
    console.log("   → Những chữ này sẽ hiện bằng font khác (lệch kiểu chữ) hoặc thành ô vuông □.");
    console.log(`   → Sửa: npm run dev -- font "<thư mục game>" --fix   (dùng font Be Vietnam Pro kèm theo tool)`);
  }
  if (c.info.pluginFonts.length) {
    console.log("\n   ℹ Plugin có cấu hình font riêng (Font Doctor không đổi font của plugin):");
    for (const p of c.info.pluginFonts) console.log(`     - ${p.plugin}: ${p.file}`);
  }
  if (c.choice) console.log(`\n   Đang chọn font thay thế: ${c.choice}  (bỏ: --reset)`);
  if (!c.hasTranslation) console.log("\n   (Chưa có bản dịch trong output → chỉ kiểm tra bảng chữ tiếng Việt.)");
}

// ---------------------------------------------------------------------------
// In kết quả
// ---------------------------------------------------------------------------

function printScan(session: GameSession) {
  const { formats } = session;
  console.log(`Tìm thấy ${formats.length} định dạng chữ trong game:\n`);
  formats.forEach((f, i) => {
    console.log(`${i === 0 ? "★" : "•"} ${f.id} – ${f.label}${i === 0 && formats.length > 1 ? "  (mặc định)" : ""}`);
    for (const line of f.info) console.log(`  ${line}`);
    console.table(f.files.map(x => ({
      file: x.name, group: x.group,
      "dịch": x.hasText ? (x.optional ? "tùy chọn (--files)" : "✓") : "",
    })));
  });
}

function printSummary(s: PlanSummary) {
  console.log("📊 Thống kê");
  console.log(`  Dòng chữ           : ${fmtNum(s.lines)} (${fmtNum(s.files)} file)`);
  console.log(`  Câu sau khi gộp    : ${fmtNum(s.segments)}`);
  console.log(`  Câu khác nhau      : ${fmtNum(s.unique)} (~${fmtNum(s.uniqueChars)} ký tự)`);
  console.log(`  Đã có trong memory : ${fmtNum(s.cached)}`);
  console.log(`  → Cần dịch         : ${fmtNum(s.pending)} câu (~${fmtNum(s.pendingChars)} ký tự)\n`);
}

function printEstimates(pending: string[]) {
  const rows = estimateRows(ctx, pending);
  if (!rows.length) return;
  console.log("💰 Ước tính (chỉ để tham khảo)");
  console.table(rows.map(r => ({
    engine: r.engine,
    "chi phí": r.cost ? fmtUsd(r.cost) : "$0",
    "thời gian": fmtMinutes(r.minutes) + (r.note ? ` (${r.note})` : ""),
  })));
}

function printGlossary(plan: Parameters<typeof glossaryView>[0]) {
  const g = glossaryView(plan);
  console.log(`📘 Glossary của game – file để bạn sửa: ${g.path}\n`);
  console.log(`Giữ nguyên (không dịch) – ${g.keep.length} mục` +
    (g.autoKeepCount ? ` (tự động từ tên nhân vật: ${g.autoKeepCount})` : ""));
  if (g.keep.length) console.log("  " + g.keep.join(", "));
  const origin = { user: "glossary.json", global: "glossary chung", map: "tên khu vực (tự đồng bộ)", actor: "tên nhân vật đã đổi" };
  console.log(`\nThuật ngữ dịch cố định – ${g.terms.length} mục`);
  if (g.terms.length) {
    console.table(g.terms.map(t => ({ "chữ gốc": t.source, "bản dịch cố định": t.target, "nguồn": origin[t.origin] })));
  }
  if (g.mapNotYet.length) console.log(`\nTên khu vực sẽ được đồng bộ khi dịch (chưa dịch): ${g.mapNotYet.join(", ")}`);
  console.log(`\nCách sửa: mở ${g.path}`);
  console.log(`  - "keep": ["Tên"]                 → giữ nguyên thêm tên này`);
  console.log(`  - "terms": {"Strength": "Thể lực"} → luôn dịch "Strength" thành "Thể lực"`);
  console.log(`  - "translate": ["Young Woman"]     → bỏ tên này khỏi danh sách tự động giữ nguyên`);
  console.log(`Đổi bản dịch của 1 thuật ngữ rồi chạy lại translate: KHÔNG phải dịch lại câu (không tốn thêm tiền).`);
}

function printTranslateResult(session: GameSession, r: TranslateResult) {
  if (r.status === "cancelled") {
    console.log("Đã hủy.");
    return;
  }
  // ---- Tiến độ theo file ----
  const nDone = r.files.filter(fileComplete).length;
  const nNone = r.files.filter(f => f.translated === 0 && !f.kept).length;
  const nPart = r.files.length - nDone - nNone;
  console.log("\n📁 Tiến độ theo file");
  // Game lớn: chỉ in file chưa xong để bảng không quá dài (bảng đầy đủ nằm trong progress.json)
  const MAX_ROWS = 40;
  const rows = (r.files.length <= MAX_ROWS ? r.files : r.files.filter(f => !fileComplete(f)))
    .map(f => ({ file: f.file, "dòng": f.lines, "đã dịch": f.translated, "trạng thái": fileStatus(f) }));
  if (rows.length) {
    console.table(rows.slice(0, MAX_ROWS));
    if (rows.length > MAX_ROWS) console.log(`   … và ${rows.length - MAX_ROWS} file khác chưa xong`);
  }
  console.log(`   ✅ ${nDone} file xong · 🟡 ${nPart} file dở dang · ⬜ ${nNone} file chưa dịch` +
    `  (đầy đủ: ${r.progressPath})`);

  // ---- Báo cáo ----
  console.log(`\n${r.status === "stopped" ? "⏸ Đã dừng" : "✅ Hoàn tất"} sau ${fmtDuration(r.elapsedMs)}`);
  for (const u of r.engines) {
    const extra = u.paid && u.tokensIn !== undefined
      ? ` – ${fmtNum(u.tokensIn)} token vào / ${fmtNum(u.tokensOut ?? 0)} token ra – ` +
        (u.costUsd !== undefined ? `≈ $${u.costUsd.toFixed(3)}` : "chưa có giá trong config.json")
      : " – $0";
    console.log(`   ${u.engine}: ${fmtNum(u.sentences)} câu${extra}`);
  }
  if (r.fallbackUsed) console.log(`   AI không dịch → đã dùng Google: ${fmtNum(r.fallbackUsed)} câu`);
  if (r.failed) console.log(`   Không engine nào dịch được: ${fmtNum(r.failed)} câu (giữ bản gốc)`);
  if (r.untranslated) console.log(`   Đoạn chưa dịch (giữ bản gốc): ${fmtNum(r.untranslated)}`);
  if (r.errorCount) console.log(`   ⚠ ${r.errorCount} dòng lỗi placeholder → giữ bản gốc. Xem ${r.errorsPath}`);
  if (r.pricedPaid) console.log("   (Chi phí là ước tính theo bảng giá trong config.json – số chính xác xem trên trang quản lý API.)");
  if (r.stopReason) {
    console.log(`\n   Lý do dừng: ${r.stopReason}\n   → Chạy lại cùng lệnh để dịch tiếp phần còn lại (phần đã dịch không bị dịch lại).`);
  }
  console.log(`\nĐã ghi ${r.files.length} file vào ${r.outDir}`);
  console.log(`→ Chép vào game: npm run dev -- export "<thư mục game>"   (có kiểm tra an toàn, restore được)`);
  if (session.fmt.note) console.log(`ℹ ${session.fmt.note}`);
}

const EXPORT_TEXT: Record<FileResult["status"], [string, string]> = {
  new: ["✅ Đã chép", "Sẽ chép"],
  update: ["✅ Đã cập nhật", "Sẽ cập nhật"],
  same: ["= Giống hệt, bỏ qua", "= Giống hệt, bỏ qua"],
  conflict: ["⛔ Xung đột – bỏ qua", "⛔ Xung đột – sẽ bỏ qua"],
  "missing-source": ["⛔ Không có bản gốc – bỏ qua", "⛔ Không có bản gốc"],
};

function printExport(results: FileResult[], dryRun: boolean) {
  const rows = results.map(r => ({
    file: r.name,
    "kết quả": r.status === "conflict" && r.written ? "⚠ Ghi đè (đã backup bản cũ)" : EXPORT_TEXT[r.status][dryRun ? 1 : 0],
  }));
  const shown = rows.filter(r => !r["kết quả"].startsWith("="));
  if (shown.length) console.table(shown.slice(0, 60));
  if (shown.length > 60) console.log(`   … và ${shown.length - 60} file khác`);
  const n = (st: FileResult["status"]) => results.filter(r => r.status === st).length;
  const written = results.filter(r => r.written).length;
  console.log(dryRun
    ? `(Chạy thử – chưa ghi gì) Sẽ chép ${n("new") + n("update")} file · giống hệt ${n("same")} · xung đột ${n("conflict")}`
    : `Đã chép ${written} file vào game · giống hệt ${n("same")} · xung đột bị bỏ qua ${results.filter(r => r.status === "conflict" && !r.written).length}`);
  if (n("conflict") && !results.some(r => r.backup)) {
    console.log("\n⛔ File \"xung đột\" = file trong game đã bị thay đổi bởi thứ khác (game cập nhật, mod khác, sửa tay...).");
    console.log("   Tool không ghi đè để tránh làm hỏng. Nếu chắc chắn, chạy lại kèm --force (bản hiện tại sẽ được backup).");
  }
  const b = results.find(r => r.backup)?.backup;
  if (b) console.log(`\nBản cũ của file bị ghi đè đã được backup vào: ${dirname(b)}`);
  if (!dryRun && written) console.log(`\n→ Muốn đưa game về bản gốc: npm run dev -- restore "<thư mục game>"`);
}

function printRestore(results: RestoreResult[], dryRun: boolean) {
  if (results.length === 0) {
    console.log("Không có file nào do tool chép vào game cần khôi phục.");
    return;
  }
  const text: Record<RestoreResult["status"], string> = {
    restored: dryRun ? "Sẽ khôi phục" : "✅ Đã khôi phục",
    "already-original": "= Đã là bản gốc",
    conflict: "⛔ Xung đột – bỏ qua (file đã bị sửa sau khi xuất)",
    "missing-source": "⛔ Không có bản gốc",
  };
  const rows = results.map(r => ({
    file: r.name, "kết quả": r.status === "conflict" && r.written ? "⚠ Ghi đè (đã backup bản cũ)" : text[r.status],
  }));
  const shown = rows.filter(r => !r["kết quả"].startsWith("="));
  if (shown.length) console.table(shown.slice(0, 60));
  if (shown.length > 60) console.log(`   … và ${shown.length - 60} file khác`);
  console.log(`${dryRun ? "(Chạy thử) Sẽ khôi phục" : "Đã khôi phục"} ${results.filter(r => r.status === "restored").length} file về bản gốc`);
  if (results.some(r => r.status === "conflict" && !r.written)) {
    console.log("Có file xung đột chưa khôi phục. Nếu chắc chắn, chạy lại kèm --force (bản hiện tại sẽ được backup).");
  }
}

// ---------------------------------------------------------------------------
// Lệnh không theo game
// ---------------------------------------------------------------------------

async function cleanCommand() {
  const plan = planClean(ctx, flag("all") ? undefined : root);
  if (!plan.exists) {
    console.log(`Không có gì để dọn (${plan.target} không tồn tại).`);
    return;
  }
  console.log(`Sẽ dọn: ${plan.target}  (${fmtBytes(plan.bytes)}, ${plan.files} file)`);
  console.log("Giữ lại: projects\\<game>\\ (memory dịch, glossary, bản chép data gốc, backup).");
  if (!flag("yes")) {
    if (!interactive) throw new Error("Không chạy trong terminal → không hỏi được. Thêm --yes để xác nhận.");
    if (!(await confirm("Xác nhận dọn?"))) { console.log("Đã hủy."); return; }
  }
  const how = runClean(plan);
  console.log(how === "trash" ? "✅ Đã chuyển vào Thùng rác (khôi phục được nếu lỡ tay)." : "✅ Đã xóa.");
}

async function checkEnginesCommand() {
  console.log("Đang kiểm tra các engine (engine AI sẽ dịch thử 1 câu ngắn, tốn rất ít token)...\n");
  const rows = await checkEngines(ctx, list("engine"));
  console.table(rows.map(r => ({
    engine: r.engine,
    result: r.status === "ok" ? `✅ ${r.detail}`
      : r.status === "missing" ? `⚪ ${r.detail}${r.keyEnv ? ` → npm run dev -- set-key ${r.engine}` : ""}`
      : `❌ ${r.detail}`,
  })));
}

async function setKeyCommand() {
  const engine = positional[0] ?? "";
  const base = engine.startsWith("claude") ? "claude" : engine;
  if (!KEY_ENV[base]) {
    console.error(`Cách dùng: npm run dev -- set-key <${Object.keys(KEY_ENV).join(" | ")}>`);
    process.exitCode = 1;
    return;
  }
  if (!interactive) throw new Error("Lệnh này cần chạy trong terminal để nhập key.");
  const r = await setKey(ctx, engine);
  if (r === "cancelled") console.log("Đã hủy.");
}

// ---- Điều phối lệnh ----
const fail = (e: unknown) => {
  console.error("\n❌", (e as Error).message);
  process.exit(1);
};

if (cmd === "check-engines") {
  checkEnginesCommand().catch(fail);
} else if (cmd === "check-google") {
  console.log("Đang kiểm tra các cách gọi Google Dịch...\n");
  checkGoogle().then(rows => console.table(rows)).catch(fail);
} else if (cmd === "set-key") {
  setKeyCommand().catch(fail);
} else if (cmd === "clean" && (root || flag("all"))) {
  cleanCommand().catch(fail);
} else if (!cmd || !root) {
  console.error(USAGE);
  process.exit(1);
} else {
  main().catch(fail);
}
