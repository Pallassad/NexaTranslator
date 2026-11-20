import { useEffect, useState } from "react";
import type { EngineCheck, KeyStatus, SettingsDTO, SettingsPatch } from "../../../shared/api";
import { Spinner } from "../components/common";
import { I } from "../components/Icon";
import { errMsg } from "../lib/format";
import { setState, toast, useApp } from "../lib/store";
import { useReduceMotion, type ThemePref } from "../lib/theme";

const ENGINE_LABEL: Record<string, string> = {
  google: "Google (Free)", claude: "Claude (Haiku mặc định)", "claude-haiku": "Claude Haiku", "claude-sonnet": "Claude Sonnet",
  ai: "AI tương thích OpenAI", deepl: "DeepL", azure: "Azure", mock: "Mock (kiểm thử)",
};
const KEY_LABEL: Record<string, string> = { claude: "Claude", ai: "AI tương thích OpenAI", deepl: "DeepL" };
const LANG: Record<string, string> = {
  auto: "Tự nhận diện", vi: "Tiếng Việt", en: "Tiếng Anh", ja: "Tiếng Nhật",
  "zh-CN": "Tiếng Trung (giản thể)", "zh-TW": "Tiếng Trung (phồn thể)", ko: "Tiếng Hàn",
};
const SOURCE_OPTIONS = ["auto", "ja", "zh-CN", "zh-TW", "en", "ko"];
const PAID_OPTIONS: [string, string, string][] = [
  ["claude-haiku", "Claude Haiku", "Rẻ, nhanh – đủ tốt cho đa số game"],
  ["claude-sonnet", "Claude Sonnet", "Dịch hay hơn, nhưng đắt hơn Haiku nhiều"],
  ["", "Không dùng", "Google bị chặn thì dừng, không hỏi dùng AI"],
];

/** Màn 6 – Cài đặt (ghi vào config.json trong thư mục dữ liệu). */
export function SettingsScreen({ theme }: { theme: { pref: ThemePref; choose: (p: ThemePref) => void } }) {
  const s = useApp();
  const [reduce, setReduce] = useReduceMotion();
  const [cfg, setCfg] = useState<SettingsDTO | null>(null);
  const [keys, setKeys] = useState<KeyStatus[]>([]);
  const [checks, setChecks] = useState<EngineCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [section, setSection] = useState("set-look");
  const [saving, setSaving] = useState<keyof SettingsPatch | null>(null);
  const [costText, setCostText] = useState("");

  useEffect(() => { if (cfg) setCostText(cfg.maxCost ? cfg.maxCost.toFixed(2) : ""); }, [cfg]);

  /** Lưu 1 mục cài đặt ngay khi đổi. */
  const save = async (patch: SettingsPatch, done: string) => {
    const key = Object.keys(patch)[0] as keyof SettingsPatch;
    setSaving(key);
    try {
      const next = await window.nexa.saveSettings(patch);
      setCfg(next);
      if ("maxCost" in patch) setState({ maxCost: next.maxCost ? next.maxCost.toFixed(2) : "" });
      toast("success", done);
    } catch (e) {
      toast("error", "Không lưu được cài đặt", errMsg(e));
    } finally {
      setSaving(null);
    }
  };
  const saveCost = (unlimited = false) => {
    if (!cfg) return;
    if (unlimited) { if (cfg.maxCost) save({ maxCost: null }, "Mặc định: không giới hạn chi phí"); return; }
    const v = parseFloat(costText.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0 || v > 1000) {
      toast("error", "Giới hạn chi phí không hợp lệ", "Nhập số tiền từ $0.01 đến $1000, ví dụ 1.00");
      setCostText(cfg.maxCost ? cfg.maxCost.toFixed(2) : "");
      return;
    }
    if (v === cfg.maxCost) return;
    save({ maxCost: Math.round(v * 100) / 100 }, `Giới hạn chi phí mặc định: $${v.toFixed(2)}`);
  };
  const running = Boolean(s.run);

  const reloadKeys = () => window.nexa.engines.keys().then(setKeys).catch(() => {});
  useEffect(() => {
    window.nexa.settings().then(setCfg).catch(e => toast("error", "Không đọc được cài đặt", errMsg(e)));
    reloadKeys();
  }, []);
  // Hộp thoại nhập key đóng → đọc lại trạng thái key
  useEffect(() => { if (!s.keyDialog) reloadKeys(); }, [s.keyDialog]);

  const runCheck = async () => {
    setChecking(true);
    try { setChecks(await window.nexa.engines.check()); } catch (e) { toast("error", "Không kiểm tra được engine", errMsg(e)); } finally { setChecking(false); }
  };
  const enterKey = async (engine: string) => {
    setState({ keyDialog: { engine, promptId: null, attempt: 1, checking: false, status: null, save: true } });
    try { await window.nexa.engines.setKey(engine); } catch (e) { toast("error", "Không lưu được key", errMsg(e)); setState({ keyDialog: null }); }
    reloadKeys();
  };

  const nav = [["set-look", "Giao diện"], ["set-engine", "Engine dịch"], ["set-key", "API key"], ["set-data", "Dữ liệu"]];
  const jump = (id: string) => { setSection(id); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  return (
    <div className="page">
      <div className="page-head"><div className="grow"><h1>Cài đặt</h1><p>Áp dụng cho mọi game, lưu ngay khi bạn đổi. Cài đặt riêng từng game (định dạng, độ rộng dòng) nằm ở tab Dịch.</p></div></div>
      <div className="set-layout">
        <nav className="set-nav">{nav.map(([id, l]) => <a key={id} href={`#${id}`} className={section === id ? "on" : ""} onClick={e => { e.preventDefault(); jump(id); }}>{l}</a>)}</nav>
        <div>
          <section className="set-sec" id="set-look">
            <h2>Giao diện</h2>
            <div className="panel">
              <div className="set-row">
                <div className="lbl"><strong>Chế độ màu</strong><span>Theo Windows sẽ tự đổi khi bạn đổi chế độ sáng/tối của Windows.</span></div>
                <div className="seg">
                  {([["light", "i-sun", "Sáng"], ["dark", "i-moon", "Tối"], ["system", "i-monitor", "Theo Windows"]] as const).map(([p, ic, l]) => (
                    <button key={p} aria-pressed={theme.pref === p} onClick={() => theme.choose(p)}><I id={ic} size="sm" />{l}</button>
                  ))}
                </div>
              </div>
              <div className="set-row">
                <div className="lbl"><strong>Giảm hiệu ứng chuyển động</strong><span>Tắt vệt sáng trên thanh tiến độ và hiệu ứng chuyển màn.</span></div>
                <input type="checkbox" className="switch" checked={reduce} onChange={e => setReduce(e.target.checked)} aria-label="Giảm hiệu ứng chuyển động" />
              </div>
            </div>
          </section>

          <section className="set-sec" id="set-engine">
            <h2>Engine dịch</h2>
            <div className="panel">
              <div className="set-row">
                <div className="lbl"><strong>Engine dùng trước</strong><span>Bị chặn thì Nexa hỏi bạn trước khi chuyển sang engine trả phí.</span></div>
                <span>{cfg ? cfg.engines.map(e => ENGINE_LABEL[e] ?? e).join(" → ") : "…"}</span>
              </div>
              <div className="set-row">
                <div className="lbl"><strong>Engine trả phí dự phòng</strong><span>Dùng khi Google bị chặn. Tính tiền vào tài khoản API của bạn – luôn hỏi trước khi dùng.</span></div>
                <div className="paid-pick" role="radiogroup" aria-label="Engine trả phí dự phòng">
                  {PAID_OPTIONS.map(([v, l, d]) => (
                    <button key={v || "none"} role="radio" aria-checked={cfg?.paidEngine === v} className={`pick ${cfg?.paidEngine === v ? "on" : ""}`}
                      disabled={!cfg || running || saving !== null}
                      onClick={() => cfg && cfg.paidEngine !== v && save({ paidEngine: v }, v ? `Engine trả phí: ${l}` : "Đã tắt engine trả phí")}>
                      <strong>{l}</strong><span>{d}</span>
                    </button>
                  ))}
                </div>
              </div>
              {cfg && cfg.paidEngine && !PAID_OPTIONS.some(o => o[0] === cfg.paidEngine) && (
                <p className="hint" style={{ padding: "0 20px 12px" }}>Đang dùng “{cfg.paidEngine}” (đặt trong config.json). Chọn một mục ở trên để đổi.</p>
              )}
              <div className="set-row">
                <div className="lbl"><strong>Giới hạn chi phí mặc định</strong><span>Mỗi lần dịch bằng engine trả phí tự dừng khi chạm mức này. Vẫn đổi được cho từng lần ở tab Dịch.</span></div>
                <div className="cost-field">
                  <span className="cur">$</span>
                  <input className="input num" inputMode="decimal" value={costText} placeholder="Không giới hạn" aria-label="Giới hạn chi phí mặc định (USD)"
                    disabled={!cfg || running || saving !== null}
                    onChange={e => setCostText(e.target.value)} onBlur={() => costText.trim() ? saveCost() : saveCost(true)}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                </div>
                <button className="btn ghost sm" disabled={!cfg?.maxCost || running || saving !== null} onClick={() => { setCostText(""); saveCost(true); }}>Không giới hạn</button>
              </div>
              <div className="set-row">
                <div className="lbl"><strong>Ngôn ngữ gốc của game</strong><span>Tự nhận diện hợp với đa số game. Chọn rõ khi game lẫn nhiều thứ tiếng. Đổi không làm mất bản dịch đã có.</span></div>
                <select className="select" value={cfg?.from ?? "auto"} disabled={!cfg || running || saving !== null} aria-label="Ngôn ngữ gốc"
                  onChange={e => save({ from: e.target.value }, `Ngôn ngữ gốc: ${LANG[e.target.value] ?? e.target.value}`)}>
                  {SOURCE_OPTIONS.map(l => <option key={l} value={l}>{LANG[l]}</option>)}
                  {cfg && !SOURCE_OPTIONS.includes(cfg.from) && <option value={cfg.from}>{cfg.from}</option>}
                </select>
              </div>
              <div className="set-row">
                <div className="lbl"><strong>Dịch sang</strong><span>Nexa dịch sang tiếng Việt.</span></div>
                <span>{LANG[cfg?.to ?? "vi"] ?? cfg?.to}</span>
              </div>
              <div className="set-row">
                <div className="lbl"><strong>Kiểm tra engine</strong><span>Dịch thử một câu ngắn với mỗi engine. Engine AI tốn vài token.</span></div>
                <button className="btn" onClick={runCheck} disabled={checking}>{checking ? <Spinner /> : <I id="i-refresh" />}Kiểm tra</button>
              </div>
              {checks && (
                <div style={{ padding: "0 20px 16px" }}>
                  <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Engine</th><th>Kết quả</th></tr></thead><tbody>
                    {checks.map(c => (
                      <tr key={c.engine}><td>{c.engine}</td><td>
                        {c.status === "ok" ? <><span className="badge success"><I id="i-check" />Dùng được</span> <span className="hint">“{c.detail}”</span></>
                          : c.status === "missing" ? <><span className="badge">Chưa có key</span> <span className="hint">{c.detail}</span></>
                          : <><span className="badge error"><I id="i-x-circle" />Lỗi</span> <span className="hint">{c.detail}</span></>}
                      </td></tr>
                    ))}
                  </tbody></table></div>
                </div>
              )}
            </div>
          </section>

          <section className="set-sec" id="set-key">
            <h2>API key</h2>
            <div className="panel">
              {keys.map(k => (
                <div className="set-row" key={k.engine}>
                  <div className="lbl"><strong>{KEY_LABEL[k.engine] ?? k.engine}</strong>
                    <span>{k.has ? (k.source === "encrypted" ? "Đã lưu trong kho mã hóa của Windows" : "Đang lấy từ file .env") : "Chưa có key"}</span></div>
                  <span className={`badge ${k.has ? "success" : ""}`}>{k.has ? <><I id="i-check" />Đã có</> : "Chưa có"}</span>
                  <button className="btn" onClick={() => enterKey(k.engine)} disabled={Boolean(s.run) || !cfg?.encryptionAvailable}><I id="i-key" />{k.has ? "Đổi key" : "Nhập key"}</button>
                </div>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              {cfg && !cfg.encryptionAvailable ? "Máy này không dùng được kho mã hóa của Windows nên chưa lưu key trong app được. " : ""}
              Key không bao giờ hiện trong nhật ký hay màn hình này – Nexa chỉ cho biết đã có key hay chưa.
            </p>
          </section>

          <section className="set-sec" id="set-data">
            <h2>Dữ liệu</h2>
            <div className="panel">
              <div className="set-row">
                <div className="lbl"><strong>Thư mục dữ liệu</strong><span>{cfg?.dataDir ?? "…"}</span></div>
                <button className="btn" onClick={() => window.nexa.openDataDir()}><I id="i-folder" />Mở thư mục</button>
              </div>
              <div className="set-row">
                <div className="lbl"><strong>Bên trong có</strong><span>config.json (cấu hình), library.json (thư viện), keys.json (key đã mã hóa), output\ (bản dịch), projects\ (memory, glossary, bản gốc, sao lưu)</span></div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
