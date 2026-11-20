// Cập nhật bản app đang dùng bằng code mới nhất (chạy sau khi build: npm run deploy).
//
//   npm run deploy -- "D:\NexaTranslation"   ← lần đầu: chỉ thư mục app đang dùng (được nhớ lại)
//   npm run deploy                           ← các lần sau
//
// Chép release/win-unpacked đè lên thư mục app. Dữ liệu cạnh exe (config.json, library.json, keys.json,
// projects/, output/, .nexa/) KHÔNG có trong bản build nên được giữ nguyên.
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve("release", "win-unpacked");
const EXE = "Nexa Translation.exe";
const MEMO = resolve("deploy.local.json");   // nhớ thư mục app (không đưa lên git)

const fail = msg => { console.error(`\n❌ ${msg}\n`); process.exit(1); };

let target = process.argv[2];
if (!target && existsSync(MEMO)) target = JSON.parse(readFileSync(MEMO, "utf8")).target;
if (!target) fail('Chưa biết thư mục app. Chạy: npm run deploy -- "D:\\NexaTranslation"');
target = resolve(target);

if (!existsSync(join(SRC, EXE))) fail(`Không thấy bản build ở ${SRC}. Build có lỗi ở bước trước?`);
if (!existsSync(target)) fail(`Thư mục ${target} không tồn tại.`);
// Chống chép nhầm vào thư mục khác: thư mục phải đang có app, hoặc đang trống
if (!existsSync(join(target, EXE)) && readdirSync(target).length > 0) {
  fail(`${target} không phải thư mục app Nexa (không có "${EXE}") – kiểm tra lại đường dẫn.`);
}
// App đang mở → Windows khóa file exe
if (existsSync(join(target, EXE))) {
  try {
    renameSync(join(target, EXE), join(target, EXE + ".tmp"));
    renameSync(join(target, EXE + ".tmp"), join(target, EXE));
  } catch {
    fail("Nexa đang mở – tắt app rồi chạy lại lệnh.");
  }
}

console.log(`\nĐang cập nhật ${target} ...`);
cpSync(SRC, target, { recursive: true, force: true });
writeFileSync(MEMO, JSON.stringify({ target }, null, 2));
console.log(`✓ Đã cập nhật Nexa Translation – mở lại app để dùng bản mới.\n`);
