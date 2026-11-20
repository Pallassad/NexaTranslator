import { useCallback, useEffect, useState } from "react";
import type { FontCheck } from "../../../shared/api";
import { Empty, Spinner } from "../components/common";
import { I } from "../components/Icon";
import { handleError } from "../lib/actions";
import { go, setState, toast, useApp } from "../lib/store";

/** Màn 5 – Font Doctor (chỉ game RPG Maker). */
export function FontScreen() {
  const s = useApp();
  const [check, setCheck] = useState<FontCheck | null>(null);
  const [loading, setLoading] = useState(false);
  const running = Boolean(s.run);

  const run = useCallback(async () => {
    if (!s.gameId) return;
    setLoading(true);
    try { setCheck(await window.nexa.game.fontCheck(s.gameId)); } catch (e) { handleError(e, "Không kiểm tra được font"); } finally { setLoading(false); }
  }, [s.gameId]);
  useEffect(() => { setCheck(null); if (s.view?.hasFont) run(); }, [run, s.view?.hasFont]);

  if (!s.gameId) {
    return <div className="page"><Empty title="Chọn game trước"
      action={<button className="btn primary" onClick={() => go("library")}><I id="i-folder" />Mở thư viện game</button>}>
      Kết quả kiểm tra font là riêng của từng game. Mở một game trong thư viện để xem.
    </Empty></div>;
  }
  if (s.view && !s.view.hasFont) {
    return <div className="page"><Empty icon="i-type" title="Font Doctor không dùng cho game này">Font Doctor chỉ kiểm tra được game RPG Maker MV/MZ.</Empty></div>;
  }

  const pickOther = async () => {
    const p = await window.nexa.game.pickFontFile();
    if (p) setState({ dialog: { kind: "font-fix", fontPath: p } });
  };
  const reset = async () => {
    try {
      await window.nexa.game.fontReset(s.gameId!);
      toast("success", "Đã dùng lại font gốc", "Chép vào game hoặc khôi phục bản gốc để áp dụng.");
      run();
    } catch (e) { handleError(e, "Không khôi phục được font"); }
  };

  const missing = check?.main?.missing ?? [];
  let status: React.ReactNode;
  if (loading || !check) {
    status = <div className="status-card"><div className="big neutral"><Spinner large /></div><div><h3>Đang kiểm tra font...</h3>
      <p className="muted" style={{ margin: "4px 0 0" }}>Đang so bảng chữ tiếng Việt và chữ trong bản dịch với font của game.</p></div></div>;
  } else if (check.choice) {
    status = <div className="status-card"><div className="big success"><I id="i-check-circle" size="lg" /></div><div><h3>Đang dùng font thay thế {check.choice}</h3>
      <p className="muted" style={{ margin: "4px 0 0" }}>Font này được thêm vào bản dịch mỗi lần dịch. Bấm Chép vào game ở tab Dịch để áp vào game.</p></div></div>;
  } else if (!check.main) {
    status = <div className="status-card"><div className="big warning"><I id="i-alert" size="lg" /></div><div><h3>Không tìm thấy file font của game</h3>
      <p className="muted" style={{ margin: "4px 0 0" }}>Game đang dùng font của hệ thống. Nếu chữ tiếng Việt hiện lỗi trong game, hãy đổi sang Be Vietnam Pro.</p></div></div>;
  } else if (missing.length === 0) {
    status = <div className="status-card"><div className="big success"><I id="i-check-circle" size="lg" /></div><div><h3>Font đủ chữ tiếng Việt</h3>
      <p className="muted" style={{ margin: "4px 0 0" }}>{check.main.family} có đủ {check.checkedChars} ký tự cần dùng (tiếng Việt và chữ trong bản dịch). Không cần đổi font.</p></div></div>;
  } else {
    status = <div className="status-card"><div className="big warning"><I id="i-alert" size="lg" /></div><div style={{ minWidth: 0 }}>
      <h3>Font của game thiếu {missing.length} chữ tiếng Việt</h3>
      <p className="muted" style={{ margin: "4px 0 0" }}>Những chữ này sẽ hiện bằng font khác (lệch kiểu chữ) hoặc thành ô vuông □ trong game.</p>
      <div className="chars">{missing.slice(0, 80).map(c => <span key={c}>{c}</span>)}{missing.length > 80 && <span>+{missing.length - 80}</span>}</div>
    </div></div>;
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Font Doctor</h1>
          <p>Kiểm tra font của <b>{s.view?.card.name}</b> có đủ chữ tiếng Việt không, và đổi sang font đủ dấu nếu thiếu.</p>
        </div>
        <button className="btn" onClick={run} disabled={loading}>{loading ? <Spinner /> : <I id="i-refresh" />}Kiểm tra lại</button>
      </div>
      <div className="font-grid">
        <div className="stack">
          <div className="panel"><div className="panel-body">{status}</div></div>
          {check && !check.hasTranslation && <div className="notice info"><I id="i-info" /><div>Chưa có bản dịch nên mới kiểm tra bảng chữ tiếng Việt. Sau khi dịch, kiểm tra lại để so cả chữ trong bản dịch.</div></div>}
          <div className="panel">
            <div className="panel-head"><h3>Xem trước</h3><span className="badge">Be Vietnam Pro</span></div>
            <div className="panel-body">
              <div className="preview">Cầu Cũ nằm phía bắc làng. Hãy cẩn thận khi đi qua, ngươi nhé!</div>
              <p className="hint" style={{ marginTop: 8 }}>Câu mẫu hiển thị bằng font Be Vietnam Pro kèm theo Nexa. Trong game, cỡ chữ do game quyết định.</p>
            </div>
          </div>
        </div>
        <div className="stack">
          <div className="panel">
            <div className="panel-head"><h3>Font hiện tại</h3></div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Font chính</dt><dd>{check?.choice ? <>{check.choice} <span className="muted">(thay cho {check.info.mainFile ?? "font hệ thống"})</span></> : check?.info.mainFile ?? "Không khai báo"}</dd>
                <dt>Khai báo ở</dt><dd>{check?.engine === "MZ" ? "data/System.json" : "fonts/gamefont.css"}</dd>
                <dt>Engine</dt><dd>{check ? `RPG Maker ${check.engine}` : "…"}</dd>
              </dl>
            </div>
          </div>
          {check && check.info.pluginFonts.length > 0 && (
            <div className="panel">
              <div className="panel-head"><h3>Font riêng của plugin</h3></div>
              <div className="panel-body" style={{ fontSize: "var(--fs-sm)" }}>
                {check.info.pluginFonts.map(p => (
                  <div key={p.plugin + p.file} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", gap: 12 }}><span>{p.plugin}</span><span className="muted">{p.file}</span></div>
                ))}
                <p className="hint" style={{ margin: "8px 0 0" }}>Font Doctor không đổi font do plugin tự khai báo.</p>
              </div>
            </div>
          )}
          <div className="panel">
            <div className="panel-head"><h3>Sửa font</h3></div>
            <div className="panel-body stack" style={{ gap: 10 }}>
              {!check?.choice && <button className="btn primary" disabled={running || !check} onClick={() => setState({ dialog: { kind: "font-fix" } })}><I id="i-type" />Dùng Be Vietnam Pro</button>}
              <button className="btn" disabled={running || !check} onClick={pickOther}><I id="i-folder" />Chọn file font khác...</button>
              {check?.choice && <button className="btn ghost danger" disabled={running} onClick={reset}><I id="i-restore" />Dùng lại font gốc</button>}
              <p className="hint" style={{ margin: 0 }}>Font mới được thêm vào bản dịch, font gốc trong game không bị xóa. Bấm Chép vào game ở tab Dịch để áp vào game.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Gọi sau khi người dùng xác nhận đổi font (hộp thoại font-fix). */
export async function applyFontFix(gameId: string, fontPath?: string) {
  try {
    const r = await window.nexa.game.fontFix(gameId, fontPath);
    toast("success", `Đã đổi font sang ${r.family}`, "Bấm Chép vào game ở tab Dịch để áp vào game.");
  } catch (e) {
    handleError(e, "Không đổi được font");
  }
}
