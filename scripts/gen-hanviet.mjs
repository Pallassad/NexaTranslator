// Tạo assets/hanviet.json (chữ Hán → âm Hán Việt) – CHỈ chạy lúc phát triển, app không cần chạy lại.
// Nguồn: gói hanviet-pinyin-words (MIT, xem assets/hanviet.LICENSE.txt); chọn âm theo pinyin phổ biến (pinyin-pro),
// thêm chữ giản thể qua opencc-js. Cách chạy: npm pack hanviet-pinyin-words, giải nén cạnh file này,
// npm i --no-save pinyin-pro opencc-js, rồi node scripts/gen-hanviet.mjs. Sau đó sửa tay vài chữ (丽/麗 → lệ, 操 → tháo).
import fs from "node:fs";
import * as OpenCC from "opencc-js";
import { pinyin } from "pinyin-pro";
const { hanvietData } = await import("./hanviet-pinyin-words-2.1.7/package/src/hanvietData.js");
const toT = OpenCC.Converter({ from: "cn", to: "tw" });
const toS = OpenCC.Converter({ from: "tw", to: "cn" });
const py = c => pinyin(c, { toneType: "num", type: "array" })[0]?.replace(/0$/, "5");
function pick(c) {
  const d = hanvietData[c]; if (!d) return undefined;
  if (d["*"]?.length) return d["*"][0];
  const p = py(c); if (p && d[p]?.length) return d[p][0];
  for (const v of Object.values(d)) if (v.length) return v[0];
}
const out = {};
for (const c of Object.keys(hanvietData)) { const r = pick(c); if (r) out[c] = r; }
let added = 0;
for (const c of Object.keys(hanvietData)) { const s = toS(c); for (const ch of [...s]) if (!out[ch] && out[c] && [...s].length === 1) { out[ch] = pick(c); added++; } }
// ký tự giản thể khác: duyệt toàn dải CJK cơ bản
for (let cp = 0x4E00; cp <= 0x9FFF; cp++) { const c = String.fromCodePoint(cp); if (out[c]) continue; const t = toT(c); if (t !== c && out[t]) { out[c] = out[t]; added++; } }
console.log("entries", Object.keys(out).length, "simplified added", added);
const sample = "李白上王龙张伟刘备陈冰雪华丽凤凰玲珑小雨梦瑶赵云诸葛亮曹操孙悟空贾宝玉薛宝钗紫萱曾长乐";
console.log([...sample].map(c => `${c}=${out[c]}`).join(" "));
fs.writeFileSync(new URL("../assets/hanviet.json", import.meta.url), JSON.stringify(out));
console.log(fs.statSync(new URL("../assets/hanviet.json", import.meta.url)).size);
