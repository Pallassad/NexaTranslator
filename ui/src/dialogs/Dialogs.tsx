import { useState } from "react";
import { Dialog, Notice, Spinner } from "../components/common";
import { I } from "../components/Icon";
import { answerPaid, cancelKey, exportRun, openGame, restoreRun, submitKey } from "../lib/actions";
import { errMsg, fmt, formatLabel, minutesRange, usd, usdRange } from "../lib/format";
import { getState, setState, toast, useApp } from "../lib/store";
import { applyFontFix } from "../screens/Font";

const close = () => setState({ dialog: null });

/** Mọi hộp thoại của app (vẽ ở gốc, theo s.dialog / s.keyDialog). */
export function Dialogs() {
  const s = useApp();
  // Thứ tự vẽ = thứ tự chồng: hộp thoại thường (vd "Thoát?") nằm trên câu hỏi trả phí / key
  return <>
    {s.paid && <PaidDialog />}
    {s.keyDialog && <KeyDialog />}
    {s.dialog && <DialogSwitch />}
  </>;
}

function DialogSwitch() {
  const d = useApp().dialog!;
  switch (d.kind) {
    case "export": {
      const p = d.preview;
      return (
        <Dialog icon={d.test ? "i-flask" : "i-export"} title={d.test ? "Chép bản dịch thử [VI] vào game" : "Chép bản dịch vào game"}
          desc={d.test
            ? `Đã thêm [VI] vào ${d.test.lines.toLocaleString("vi-VN")} dòng trong ${d.test.files} file. Chưa ghi gì vào game – bản gốc luôn được giữ để Khôi phục.`
            : "Kết quả chạy thử – chưa ghi gì vào game."} wide onClose={close}
          footer={<>
            <button className="btn ghost left" onClick={close}>Hủy</button>
            {p.conflicts.length > 0 && <button className="btn" onClick={() => exportRun(true)}>Ghi đè cả file xung đột (có sao lưu)</button>}
            <button className="btn primary" onClick={() => exportRun(false)} disabled={!p.write.length}>
              {p.conflicts.length ? "Chép, bỏ qua file xung đột" : `Chép ${p.write.length} file`}
            </button>
          </>}>
          {d.test && <Notice tone="info">Bản dịch thật (nếu có) không bị ảnh hưởng – sau khi xem xong, bấm <b>Khôi phục</b> hoặc <b>Chép vào game</b> để thay bản thử.</Notice>}
          <div className="exp-sum">
            <div><b>{p.write.length}</b><span>file sẽ chép / cập nhật</span></div>
            <div><b>{p.same}</b><span>file giống hệt, bỏ qua</span></div>
            <div className="c"><b>{p.conflicts.length}</b><span>file xung đột</span></div>
          </div>
          {p.conflicts.length > 0 && <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>File xung đột</div>
            <div className="conflicts">{p.conflicts.slice(0, 8).map(n => <div key={n}><I id="i-alert" size="sm" />{n}</div>)}
              {p.conflicts.length > 8 && <div className="muted">… và {p.conflicts.length - 8} file khác</div>}</div>
            <p className="hint" style={{ margin: "8px 0 0" }}>Xung đột nghĩa là file trong game đã bị thứ khác thay đổi sau lần chép trước (game cập nhật, mod khác, sửa tay). Mặc định Nexa bỏ qua để không làm hỏng.</p>
          </div>}
          {p.missingSource.length > 0 && <Notice tone="warning">{p.missingSource.length} file không có bản gốc đã lưu nên sẽ bỏ qua.</Notice>}
          {!p.write.length && !p.conflicts.length && <Notice tone="success">Game đã có bản dịch mới nhất – không có gì cần chép.</Notice>}
        </Dialog>
      );
    }
    case "restore":
      return (
        <Dialog icon="i-restore" tone="warning" title="Khôi phục game về bản gốc?"
          desc="Các file Nexa đã chép vào game sẽ được thay bằng bản gốc đã lưu khi bạn mở game lần đầu." onClose={close}
          footer={<>
            <button className="btn ghost" onClick={close}>Hủy</button>
            {d.conflicts.length > 0 && <button className="btn" onClick={() => restoreRun(true)}>Ghi đè cả file xung đột (có sao lưu)</button>}
            <button className="btn primary" onClick={() => restoreRun(false)} disabled={!d.count}>Khôi phục</button>
          </>}>
          <dl className="offer">
            <dt>Sẽ khôi phục</dt><dd>{d.count} file</dd>
            <dt>Bản dịch của Nexa</dt><dd>Vẫn giữ – chép lại vào game bất cứ lúc nào</dd>
          </dl>
          {d.conflicts.length > 0 && <Notice tone="warning">{d.conflicts.length} file đã bị sửa sau lần chép trước ({d.conflicts.slice(0, 3).join(", ")}{d.conflicts.length > 3 ? "…" : ""}). Mặc định sẽ bỏ qua.</Notice>}
        </Dialog>
      );
    case "source-invalid":
      return (
        <Dialog icon="i-alert" tone="error" title="Dữ liệu game không phải bản gốc"
          desc="Nexa cần bản gốc để dịch, nên đã dừng lại để không làm hỏng bản dịch." onClose={close}
          footer={<>
            <button className="btn" onClick={close}>Đóng</button>
            <button className="btn primary" onClick={() => { window.nexa.game.openFolder(d.gameId).catch(() => {}); close(); }}><I id="i-folder" />Mở thư mục game</button>
          </>}>
          <Notice tone="error">Data trong game {d.problem}.</Notice>
          <div><b>Cách sửa</b>
            <ol style={{ margin: "6px 0 0", paddingLeft: 20, color: "var(--text2)" }}>
              <li>Khôi phục thư mục data gốc của game (từ bản tải về hoặc bản sao lưu của bạn).</li>
              <li>Mở lại game này trong Nexa.</li>
            </ol>
          </div>
        </Dialog>
      );
    case "not-game":
      return (
        <Dialog icon="i-x-circle" tone="error" title="Không thêm được game" desc={d.path} onClose={close}
          footer={<button className="btn primary" onClick={close}>Đã hiểu</button>}>
          <p style={{ margin: 0 }}>{d.message}</p>
          {d.guess && <Notice tone="info">Công cụ cho game <b>{d.guess}</b> chưa có trong bản này.</Notice>}
        </Dialog>
      );
    case "remove":
      return (
        <Dialog icon="i-alert" tone="warning" title={`Xóa “${d.game.name}” khỏi thư viện?`}
          desc="Chỉ bỏ game khỏi danh sách của Nexa. Thư mục game, bản dịch và memory dịch vẫn còn nguyên." onClose={close}
          footer={<>
            <button className="btn ghost" onClick={close}>Hủy</button>
            <button className="btn danger solid" onClick={async () => {
              close();
              try {
                await window.nexa.library.remove(d.game.id);
                if (getState().gameId === d.game.id) setState({ gameId: null, view: null, stage: "idle" });
                setState(s => ({ libVersion: s.libVersion + 1 }));
                toast("success", `Đã xóa “${d.game.name}” khỏi thư viện`, "Thư mục game và bản dịch vẫn còn nguyên.");
              } catch (e) { toast("error", "Không xóa được", errMsg(e)); }
            }}>Xóa khỏi thư viện</button>
          </>} />
      );
    case "info": {
      const g = d.game;
      return (
        <Dialog icon="i-info" title={g.name} onClose={close}
          footer={<>
            <button className="btn" onClick={() => window.nexa.game.openFolder(g.id).catch(e => toast("error", "Không mở được thư mục", errMsg(e)))}><I id="i-folder" />Mở thư mục game</button>
            <button className="btn primary" onClick={() => { close(); openGame(g.id); }}>Mở game</button>
          </>}>
          <dl className="kv">
            <dt>Thư mục</dt><dd style={{ wordBreak: "break-all" }}>{g.root}</dd>
            <dt>Engine</dt><dd>{g.engine ? `RPG Maker ${g.engine}` : "Không xác định"}</dd>
            <dt>Định dạng</dt><dd>{g.formats.map(formatLabel).join(", ") || "—"}</dd>
            <dt>Tiến độ dịch</dt><dd>{g.progress ? `${fmt(g.progress.translated)} / ${fmt(g.progress.lines)} dòng` : "Chưa dịch"}</dd>
            <dt>Đã chép vào game</dt><dd>{g.exported ? "Có" : "Chưa"}</dd>
            <dt>Dữ liệu của Nexa</dt><dd className="muted">projects\{g.name}\, output\{g.name}\</dd>
          </dl>
        </Dialog>
      );
    }
    case "font-fix":
      return (
        <Dialog icon="i-type" title={d.fontPath ? "Đổi font của game sang font bạn chọn?" : "Đổi font của game sang Be Vietnam Pro?"}
          desc="Font mới được thêm vào bản dịch; font gốc trong game không bị xóa." onClose={close}
          footer={<>
            <button className="btn ghost" onClick={close}>Hủy</button>
            <button className="btn primary" onClick={async () => { const id = getState().gameId!; close(); await applyFontFix(id, d.fontPath); setState(s => ({ libVersion: s.libVersion + 1 })); }}>Đổi font</button>
          </>}>
          {d.fontPath && <p className="muted" style={{ margin: 0, wordBreak: "break-all" }}>{d.fontPath}</p>}
          <p className="muted" style={{ margin: 0 }}>Nexa kiểm tra font có đủ chữ tiếng Việt trước khi dùng. Sau khi đổi, bấm Chép vào game ở tab Dịch để áp vào game.</p>
        </Dialog>
      );
    case "quit":
      return (
        <Dialog icon="i-alert" tone="warning" title="Đang dịch, thoát Nexa?"
          desc="Nexa sẽ dừng sau lô đang dịch và lưu phần đã xong, rồi mới đóng. Lần sau mở lại sẽ dịch tiếp." onClose={close}
          footer={<>
            <button className="btn ghost" onClick={close}>Tiếp tục dịch</button>
            <button className="btn danger solid" onClick={() => { close(); setState(s => (s.run ? { run: { ...s.run, stopping: true } } : {})); window.nexa.quitAfterStop(); }}>Dừng và thoát</button>
          </>} />
      );
  }
}

function PaidDialog() {
  const o = useApp().paid!.offer;
  const text = {
    blocked: ["Engine miễn phí đang bị chặn, dùng engine trả phí để dịch tiếp?",
      "Phần đã dịch vẫn được giữ. Nexa không tự dùng engine trả phí khi chưa có sự đồng ý của bạn.", "Còn lại", "Không, dừng lại"],
    chosen: [`Dịch bằng ${o.model}?`,
      "Bạn chọn dịch bằng AI. Xem chi phí ước tính trước khi bắt đầu – câu đã có trong memory không tính tiền.", "Cần dịch", "Hủy"],
    retranslate: [`Nhờ ${o.model} dịch lại các dòng lỗi?`,
      "AI dịch lại và giữ đủ mã điều khiển. Đoạn nào AI vẫn làm hỏng sẽ giữ trong danh sách để bạn sửa tay.", "Cần dịch lại", "Hủy"],
  }[o.reason ?? "blocked"];
  return (
        <Dialog icon={o.reason === "blocked" ? "i-alert" : "i-coin"} tone="warning" title={text[0]}
          desc={text[1]}
          onClose={() => answerPaid(false)}
          footer={<>
            <button className="btn" onClick={() => answerPaid(false)}>{text[3]}</button>
            <button className="btn primary" onClick={() => answerPaid(true)}>Dùng {o.model}</button>
          </>}>
          <dl className="offer">
            <dt>{text[2]}</dt><dd className="num">{fmt(o.sentences)} câu (~{fmt(o.chars)} ký tự)</dd>
            <dt>{o.reason === "blocked" ? "Engine đề xuất" : "Engine"}</dt><dd>{o.model}</dd>
            <dt>Chi phí ước tính</dt><dd className="num">{o.cost ? usdRange(o.cost) : "Chưa có giá trong config.json – không ước tính được"}</dd>
            <dt>Thời gian ước tính</dt><dd>{minutesRange(o.minutes)}</dd>
            <dt>Giới hạn lần này</dt><dd className="num">{o.maxCost ? `${usd(o.maxCost)} – tự dừng khi chạm mức này` : "Không giới hạn"}</dd>
          </dl>
          <p className="hint" style={{ margin: 0 }}>{o.reason === "blocked"
            ? "Tiền tính vào tài khoản API của bạn. Nếu không đồng ý, Nexa dừng lại và xuất phần đã dịch; chạy lại sau sẽ dịch tiếp phần còn thiếu."
            : "Tiền tính vào tài khoản API của bạn. Bấm Hủy thì không có gì bị tính tiền."}</p>
        </Dialog>
      );
}

function KeyDialog() {
  const kd = useApp().keyDialog!;
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const label = kd.engine.startsWith("claude") ? "Claude" : kd.engine === "ai" ? "AI tương thích OpenAI" : kd.engine === "deepl" ? "DeepL" : kd.engine;
  const waitingPrompt = kd.promptId === null && !kd.checking && !kd.status;    // vừa mở từ Cài đặt, chờ main hỏi
  const exhausted = kd.promptId === null && !kd.checking && kd.status?.ok === false && kd.attempt >= 3;
  const done = kd.status?.ok === true;
  const check = () => {
    if (!key.trim()) return;
    submitKey(key.trim());
  };
  return (
    <Dialog icon="i-key" title={`Nhập API key ${label}`}
      desc="Nexa sẽ dịch thử một câu ngắn để kiểm tra key (tốn rất ít token)." onClose={cancelKey}
      footer={<>
        <button className="btn ghost" onClick={cancelKey}>{exhausted || done ? "Đóng" : "Hủy"}</button>
        {!done && !exhausted && <button className="btn primary" onClick={check} disabled={!key.trim() || kd.checking || kd.promptId === null}>
          {kd.checking ? <><Spinner />Đang kiểm tra</> : "Kiểm tra và dùng key"}
        </button>}
      </>}>
      <form onSubmit={e => { e.preventDefault(); check(); }}>
        <label className="field"><span>API key</span>
          <div className="key-field">
            <input className="input" type={show ? "text" : "password"} autoComplete="off" spellCheck={false}
              placeholder={kd.engine.startsWith("claude") ? "sk-ant-..." : "Dán key vào đây"} value={key}
              onChange={e => setKey(e.target.value)} disabled={kd.checking || done} />
            <button className="eye" type="button" title={show ? "Ẩn key" : "Hiện key"} aria-pressed={show} onClick={() => setShow(!show)}>
              <I id={show ? "i-eye-off" : "i-eye"} size="sm" />
            </button>
          </div>
        </label>
      </form>
      <div className={`key-state ${kd.checking ? "check" : kd.status ? (kd.status.ok ? "ok" : "bad") : ""}`}>
        {kd.checking ? <><Spinner />Đang dịch thử “Hello, how are you?”...</>
          : kd.status ? <><I id={kd.status.ok ? "i-check-circle" : "i-x-circle"} size="sm" />{kd.status.ok ? kd.status.message : `Key không dùng được: ${kd.status.message}`}</>
          : waitingPrompt ? <><Spinner />Đang chuẩn bị...</> : null}
      </div>
      {exhausted && <Notice tone="error">Đã thử 3 lần không thành công. Kiểm tra lại key trên trang quản lý API rồi thử lại.</Notice>}
      <label className="checkline">
        <input type="checkbox" className="cb" checked={kd.save} disabled={done}
          onChange={e => setState({ keyDialog: { ...kd, save: e.target.checked } })} />
        <span>Lưu key để lần sau khỏi nhập<br /><span className="hint">Lưu trong kho mã hóa của Windows (keys.json trong thư mục dữ liệu). Chép sang máy khác cũng không đọc được.</span></span>
      </label>
    </Dialog>
  );
}
