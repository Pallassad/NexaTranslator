import { useEffect, useMemo, useRef, useState } from "react";
import type { FileItem, TranslateEngine } from "../../../shared/api";
import { Empty, GameIcon, Notice, Spinner, usePopover } from "../components/common";
import { I, type IconId } from "../components/Icon";
import {
  estimate, exportPreview, openGame, restorePreview, setFormat, stop, testPreview, translate,
} from "../lib/actions";
import { duration, fmt, formatLabel, GROUP_ORDER, groupLabel, minutesRange, usd, usdRange } from "../lib/format";
import { go, setState, useApp, type LogLine } from "../lib/store";
import { ErrorsPanel } from "./ErrorsPanel";

/** Màn 3 – tab Dịch. */
export function TranslateScreen() {
  const s = useApp();
  if (!s.gameId) {
    return <div className="page"><Empty title="Chọn game trước"
      action={<button className="btn primary" onClick={() => go("library")}><I id="i-folder" />Mở thư viện game</button>}>
      Danh sách file và tiến độ dịch là dữ liệu riêng của từng game. Mở một game trong thư viện để bắt đầu.
    </Empty></div>;
  }
  if (s.viewLoading && !s.view) {
    return <div className="loading-page"><Spinner large /><strong>Đang đọc dữ liệu game...</strong>
      <span>Game lớn (hàng chục nghìn dòng) có thể mất vài giây.</span></div>;
  }
  if (!s.view) {
    return <div className="page"><Empty icon="i-x-circle" title="Không mở được game"
      action={<div style={{ display: "flex", gap: 8 }}>
        <button className="btn" onClick={() => go("library")}>Về thư viện</button>
        <button className="btn primary" onClick={() => { const id = s.gameId!; setState({ gameId: null }); openGame(id); }}><I id="i-refresh" />Thử lại</button>
      </div>}>{s.viewError?.message}</Empty></div>;
  }
  return (
    <div className="ws">
      <Header />
      <div className="ws-body">
        <FilePanel />
        <div className="main-col">
          <Actions />
          <div className="stage"><div className="stage-inner"><Stage /></div></div>
          <LogPanel />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- đầu trang: game, định dạng, độ rộng dòng
function Header() {
  const s = useApp();
  const v = s.view!;
  const fmtPop = usePopover();
  const widthPop = usePopover();
  const [custom, setCustom] = useState("");
  const locked = Boolean(s.run) || s.viewLoading;
  return (
    <div className="ws-head">
      <GameIcon game={v.card} size={40} />
      <div className="title"><strong>{v.card.name}</strong><span>{v.card.root}</span></div>
      {v.card.engine && <span className="badge">RPG Maker {v.card.engine}</span>}
      <div className="opts">
        {v.card.formats.length > 1 && (
          <div ref={fmtPop.ref} style={{ position: "relative" }}>
            <button className="chip-select" disabled={locked} onClick={() => fmtPop.setOpen(!fmtPop.open)}>
              <span className="k">Định dạng</span><span className="v">{formatLabel(v.format)}</span><I id="i-chev-down" size="sm" />
            </button>
            <div className={`popover ${fmtPop.open ? "open" : ""}`} role="menu" style={{ right: 0, top: 40, width: 340 }}>
              <div className="menu-title">Game này có {v.card.formats.length} loại dữ liệu chữ</div>
              {v.card.formats.map((f, i) => (
                <button key={f.id} className="menu-item" aria-checked={f.id === v.format.id}
                  onClick={() => { fmtPop.setOpen(false); if (f.id !== v.format.id) setFormat(f.id); }}>
                  <span>{formatLabel(f)}{i === 0 && <span className="badge accent" style={{ height: 18, marginLeft: 6 }}>Nên dùng</span>}
                    <span className="sub">{i === 0 ? "Nexa tự chọn loại này" : "Chỉ dùng khi bạn biết game cần"}</span></span>
                  <I id="i-check" size="sm" className="check" />
                </button>
              ))}
            </div>
          </div>
        )}
        <div ref={widthPop.ref} style={{ position: "relative" }}>
          <button className="chip-select" disabled={locked} onClick={() => widthPop.setOpen(!widthPop.open)}>
            <span className="k">Độ rộng dòng</span><span className="v">{s.width ? `${s.width} ký tự` : `Tự động (${v.autoWidth})`}</span><I id="i-chev-down" size="sm" />
          </button>
          <div className={`popover ${widthPop.open ? "open" : ""}`} role="menu" style={{ right: 0, top: 40, width: 270 }}>
            <div className="menu-title">Số ký tự tối đa mỗi dòng thoại</div>
            <button className="menu-item" aria-checked={!s.width} onClick={() => { setState({ width: null, stage: s.stage === "estimate" ? "idle" : s.stage }); widthPop.setOpen(false); }}>
              <span>Tự động ({v.autoWidth})<span className="sub">Đo từ chính game này</span></span><I id="i-check" size="sm" className="check" />
            </button>
            <div className="menu-sep" />
            <form style={{ display: "flex", gap: 6, padding: "6px 10px 8px", alignItems: "center" }}
              onSubmit={e => {
                e.preventDefault();
                const n = Number(custom);
                if (n >= 20 && n <= 120) { setState({ width: n, stage: s.stage === "estimate" ? "idle" : s.stage }); widthPop.setOpen(false); }
              }}>
              <input className="input" type="number" min={20} max={120} placeholder="20 – 120" value={custom} onChange={e => setCustom(e.target.value)} style={{ height: 32, width: 110 }} />
              <button className="btn sm" type="submit">Áp dụng</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- danh sách file
const STAT: Record<"done" | "warn" | "part" | "none", { icon: IconId; title: string }> = {
  done: { icon: "i-check-circle", title: "Đã dịch xong" },
  warn: { icon: "i-alert", title: "Xong – có dòng giữ bản gốc vì lỗi mã" },
  part: { icon: "i-half", title: "Đã dịch một phần" },
  none: { icon: "i-circle", title: "Chưa dịch" },
};
/** Dòng giữ bản gốc vì lỗi mã cũng tính là đã xử lý → file vẫn "xong" (biểu tượng cảnh báo vàng). */
const fileStat = (f: FileItem) => {
  const t = f.translated ?? 0, k = f.kept ?? 0;
  if (t === 0 && k === 0) return "none";
  if (t + k >= f.lines) return k > 0 ? "warn" : "done";
  return "part";
};

function FilePanel() {
  const s = useApp();
  const v = s.view!;
  const [q, setQ] = useState("");
  const running = Boolean(s.run);

  const groups = useMemo(() => {
    const by = new Map<string, FileItem[]>();
    for (const f of v.files) by.set(f.group, [...(by.get(f.group) ?? []), f]);
    return [...by.entries()].sort((a, b) => (GROUP_ORDER.indexOf(a[0]) + 99) % 99 - (GROUP_ORDER.indexOf(b[0]) + 99) % 99);
  }, [v.files]);

  const toggle = (names: string[], on: boolean) => setState(st => {
    const sel = new Set(st.sel);
    names.forEach(n => (on ? sel.add(n) : sel.delete(n)));
    return { sel, stage: st.stage === "estimate" ? "idle" : st.stage };
  });
  const toggleGroup = (g: string) => setState(st => {
    const c = new Set(st.collapsed);
    if (c.has(g)) c.delete(g); else c.add(g);
    return { collapsed: c };
  });

  const ql = q.trim().toLowerCase();
  const selFiles = v.files.filter(f => s.sel.has(f.name));
  let shownGroups = 0;

  return (
    <aside className="files" aria-label="Chọn file cần dịch">
      <div className="files-top">
        <div className="search"><I id="i-search" size="sm" /><input className="input" placeholder="Tìm kiếm file..." value={q} onChange={e => setQ(e.target.value)} /></div>
      </div>
      <div className="files-bar">
        <button className="btn ghost sm" disabled={running} onClick={() => toggle(v.files.map(f => f.name), true)}>Chọn tất cả</button>
        <button className="btn ghost sm" disabled={running} onClick={() => toggle(v.files.map(f => f.name), false)}>Bỏ chọn</button>
        <span className="count">Đã chọn {selFiles.length}/{v.files.length} file</span>
      </div>
      <div className="files-list">
        {v.format.id === "rpgm-data" && v.card.formats.some(f => f.id === "rpgm-kns-csv") && (
          <div style={{ margin: "4px 6px 8px" }}><Notice tone="warning">Thoại của game này nằm trong <b>csv\</b>. Định dạng JSON chỉ có mã như <b>event_data_base_text_12</b> nên hầu như không có gì để dịch.</Notice></div>
        )}
        {v.format.id === "rpgm-data" && v.card.formats.some(f => f.id === "rpgm-lang-tsv") && (
          <div style={{ margin: "4px 6px 8px" }}><Notice tone="warning">
            Thoại của game này nằm trong <b>data\Languages.tsv</b>. Event chỉ có mã như <b>\tl{"{A0001}"}</b>.
            Dịch bảng này trước, sau đó có thể dịch thêm data\ cho phần tên vật phẩm / kỹ năng chưa có trong bảng.
            <div style={{ marginTop: 8 }}><button className="btn sm" disabled={running} onClick={() => setFormat("rpgm-lang-tsv")}>Chuyển sang dịch Languages.tsv</button></div>
          </Notice></div>
        )}
        {v.format.id === "rpgm-data" && v.card.formats.some(f => f.id === "rpgm-rem-loc") && (
          <div style={{ margin: "4px 6px 8px" }}><Notice tone="warning">
            Chữ hiện trong game này nằm ở <b>www\loc</b>. File trong data\ phần lớn chỉ là mã như <b>\REM_MAP[...]</b>.
            <div style={{ marginTop: 8 }}><button className="btn sm" disabled={running} onClick={() => setFormat("rpgm-rem-loc")}>Chuyển sang dịch www\loc</button></div>
          </Notice></div>
        )}
        {groups.map(([g, items]) => {
          const shown = items.filter(f => f.name.toLowerCase().includes(ql));
          if (ql && !shown.length) return null;
          shownGroups++;
          const n = items.filter(f => s.sel.has(f.name)).length;
          const collapsed = s.collapsed.has(g) && !ql;
          return (
            <div key={g} className={`grp ${collapsed ? "collapsed" : ""}`}>
              <div className="grp-head">
                <button className="tog" aria-expanded={!collapsed} aria-label={`Thu gọn hoặc mở nhóm ${groupLabel(g)}`} onClick={() => toggleGroup(g)}><I id="i-chev-down" size="sm" /></button>
                <TriCheckbox checked={n === items.length} indeterminate={n > 0 && n < items.length} disabled={running}
                  label={`Chọn cả nhóm ${groupLabel(g)}`} onChange={() => toggle(items.map(f => f.name), n !== items.length)} />
                <span className="gname" onClick={() => toggleGroup(g)}>{groupLabel(g)}</span>
                <span className="gmeta num">{n ? `${n}/` : ""}{items.length} file</span>
              </div>
              <div className="grp-items">
                {shown.map(f => {
                  const st = STAT[fileStat(f)];
                  return (
                    <label key={f.name} className="file" title={f.optional ? "File tùy chọn – mặc định không dịch" : f.name}>
                      <input type="checkbox" className="cb" checked={s.sel.has(f.name)} disabled={running} onChange={e => toggle([f.name], e.target.checked)} />
                      <span className="fname">{f.name}{f.optional && <span className="opt-tag"><I id="i-alert" />Tùy chọn</span>}</span>
                      <span className="lines num">{fmt(f.lines)}</span>
                      <span className={`fstat ${fileStat(f)}`} title={f.translated !== undefined ? `${st.title} (${fmt(f.translated)}/${fmt(f.lines)} dòng${f.kept ? `, ${fmt(f.kept)} dòng giữ gốc` : ""})` : st.title}><I id={st.icon} /></span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
        {ql && shownGroups === 0 && (
          <Empty flat title={`Không có file khớp “${q}”`} action={<button className="btn sm" onClick={() => setQ("")}>Xóa tìm kiếm</button>}>
            Thử tên khác, ví dụ Map010.json.
          </Empty>
        )}
      </div>
      <div className="files-foot">
        <span><b className="num">{fmt(selFiles.reduce((n, f) => n + f.lines, 0))}</b> dòng được chọn</span>
        <span style={{ marginLeft: "auto" }}>Đã xong <b className="num">{v.files.filter(f => fileStat(f) === "done" || fileStat(f) === "warn").length}</b> · Dở <b className="num">{v.files.filter(f => fileStat(f) === "part").length}</b></span>
      </div>
    </aside>
  );
}

function TriCheckbox({ checked, indeterminate, disabled, label, onChange }: {
  checked: boolean; indeterminate: boolean; disabled?: boolean; label: string; onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" className="cb" checked={checked} disabled={disabled} aria-label={label} onChange={onChange} />;
}

// ---------------------------------------------------------------- nút thao tác
function Actions() {
  const s = useApp();
  const v = s.view!;
  const running = Boolean(s.run);
  const hasTranslation = Boolean(v.card.progress && v.card.progress.translated > 0);
  const p = v.card.progress;
  const complete = Boolean(p && p.translated + p.kept >= p.lines);
  return (
    <div className="actions">
      <button className="btn" onClick={estimate} disabled={running || !s.sel.size || s.estimating}>
        {s.estimating ? <Spinner /> : <I id="i-calc" />}Ước tính
      </button>
      <button className="btn primary" onClick={translate} disabled={running || !s.sel.size}><I id="i-play" />{hasTranslation && !complete ? "Dịch tiếp" : "Dịch"}</button>
      <label className="engine-pick" title={s.engine === "google"
        ? "Dịch bằng Google miễn phí. Bị chặn thì Nexa hỏi bạn có chuyển sang AI không."
        : "Dịch bằng AI ngay từ đầu. Nexa báo chi phí ước tính và hỏi trước khi bắt đầu."}>
        <span className="sr-only">Engine dịch</span>
        <select className={`select ${s.engine !== "google" ? "paid" : ""}`} value={s.engine} disabled={running} aria-label="Engine dịch"
          onChange={e => setState({ engine: e.target.value as TranslateEngine })}>
          <option value="google">Google (miễn phí)</option>
          <option value="claude-haiku">Claude Haiku ($)</option>
          <option value="claude-sonnet">Claude Sonnet ($)</option>
        </select>
      </label>
      <span className="sep" />
      <button className="btn" onClick={exportPreview} disabled={running || !hasTranslation}
        title={hasTranslation ? "Chạy thử trước, rồi hỏi bạn xác nhận" : "Chưa có bản dịch để chép"}>
        <I id="i-export" />Chép vào game
      </button>
      <button className="btn ghost" onClick={restorePreview} disabled={running || !v.card.exported}
        title={v.card.exported ? "Trả các file Nexa đã chép về bản gốc" : "Chưa chép gì vào game"}>
        <I id="i-restore" /><span className="restore-label">Khôi phục</span>
      </button>
      <label className="cost-limit" title="Giới hạn chi phí cho lần dịch này khi dùng engine trả phí (mặc định đặt trong Cài đặt)">Tối đa
        <span className="search">
          <input className="input num" value={s.maxCost} disabled={running} inputMode="decimal" aria-label="Giới hạn chi phí (USD)"
            onChange={e => setState({ maxCost: e.target.value })} style={{ paddingLeft: 22 }} />
          <span style={{ position: "absolute", left: 10, color: "var(--text3)" }}>$</span>
        </span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- khu giữa
function Stage() {
  const s = useApp();
  const v = s.view!;
  if (s.stage === "run" && s.run) return <RunPanel />;
  if (s.stage === "errors") return <ErrorsPanel />;
  if (s.stage === "result" && s.result) return <ResultPanel />;
  if (s.stage === "estimate" && s.estimate) {
    const { summary: e, rows } = s.estimate;
    return <>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}><h2>Ước tính</h2><span className="muted">{e.files} file, {fmt(e.lines)} dòng</span></div>
      <div className="facts">
        <div className="fact"><div className="v num">{fmt(e.unique)}</div><div className="k">Câu khác nhau (~{fmt(e.uniqueChars)} ký tự)</div></div>
        <div className="fact"><div className="v num">{fmt(e.cached)}</div><div className="k">Đã có trong memory</div></div>
        <div className="fact hl"><div className="v num">{fmt(e.pending)}</div><div className="k">Câu cần dịch (~{fmt(e.pendingChars)} ký tự)</div></div>
      </div>
      {rows.length > 0 ? <>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Engine</th><th>Thời gian</th><th className="r">Chi phí</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.engine}>
              <td>{r.cost ? r.engine : <><b>{r.engine}</b> <span className="badge" style={{ marginLeft: 6 }}>Mặc định</span></>}</td>
              <td>{minutesRange(r.minutes)}{r.note && <span className="hint"> ({r.note})</span>}</td>
              <td className="r num">{r.cost ? usdRange(r.cost) : <span className="badge success">Miễn phí</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="hint" style={{ margin: 0 }}>Chỉ để tham khảo. Chi phí thật xem trên trang quản lý API. Engine trả phí luôn được hỏi trước khi dùng.</p>
      </> : <Notice tone="success">Mọi câu trong các file đã chọn đã có trong memory – bấm Dịch sẽ chỉ ghi lại bản dịch, không tốn gì.</Notice>}
    </>;
  }
  const p = v.card.progress;
  const pct = p && p.lines ? (p.translated + p.kept) / p.lines : 0;
  return (<>
    {v.errorLines > 0 && <ErrorsNotice lines={v.errorLines} />}
    <div className="idle">
      <h2>{pct >= 1 ? "Game này đã dịch xong" : pct > 0 ? "Dịch tiếp từ chỗ đã dừng" : "Sẵn sàng dịch"}</h2>
      <p>{pct >= 1 ? "Mọi câu đã có trong memory. Bạn có thể chép bản dịch vào game, hoặc đổi glossary rồi dịch lại để áp thuật ngữ mới."
        : pct > 0 ? "Câu đã dịch được lưu trong memory nên sẽ không dịch lại (không tốn thêm tiền). Bấm Ước tính để xem còn bao nhiêu câu."
        : "Chọn file ở bên trái. Nên bấm Ước tính trước để biết số câu, thời gian và chi phí nếu phải dùng engine trả phí."}</p>
      <div className="flow">
        <span className="st"><I id="i-calc" size="sm" /><b>Ước tính</b></span><I id="i-chev-right" size="sm" />
        <span className="st"><I id="i-play" size="sm" /><b>Dịch</b></span><I id="i-chev-right" size="sm" />
        <span className="st"><I id="i-export" size="sm" /><b>Chép vào game</b></span><I id="i-chev-right" size="sm" />
        <span className="st">Chơi thử trong game</span>
      </div>
      <div className="test-card">
        <div className="grow">
          <strong>Dịch thử trước, chưa tốn tiền</strong>
          <span>Nexa thêm <span className="code">[VI]</span> vào đầu mọi câu nó sẽ dịch rồi chép vào game. Vào game xem: chỗ có [VI] là Nexa dịch tới,
            chỗ vẫn tiếng gốc là Nexa chưa đọc được. Xem xong bấm <b>Khôi phục</b>.</span>
        </div>
        <button className="btn" onClick={testPreview} disabled={!s.sel.size || !!s.run}><I id="i-flask" />Dịch thử [VI]</button>
      </div>
    </div>
  </>);
}

/** Thông báo còn dòng lỗi + nút mở màn sửa. */
function ErrorsNotice({ lines }: { lines: number }) {
  return (
    <div className="notice warning" style={{ alignItems: "center" }}>
      <I id="i-alert" />
      <div style={{ flex: 1 }}><b>{fmt(lines)} dòng giữ bản gốc</b> vì bản dịch máy làm hỏng mã điều khiển (màu chữ, tên nhân vật...). Xem lại để tự sửa hoặc nhờ AI dịch lại.</div>
      <button className="btn sm" onClick={() => setState({ stage: "errors", errors: null })}>Xem dòng lỗi</button>
    </div>
  );
}

function RunPanel() {
  const s = useApp();
  const r = s.run!;
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t); }, []);
  const waiting = Boolean(s.paid) || Boolean(s.keyDialog);
  const pct = r.overallTotal ? Math.floor((r.overallDone / r.overallTotal) * 100) : 0;
  const elapsed = Date.now() - r.startedAt;
  const paid = r.paid;
  const op = r.stopping ? "Đang dừng..." : waiting ? "Tạm chờ bạn quyết định" : !r.engine ? "Đang chuẩn bị..." : r.phase === "map-names" ? "Đang dịch tên khu vực" : "Đang dịch nội dung game";
  return (
    <div className={`run ${waiting || r.stopping ? "paused" : ""}`}>
      <div className="run-head">
        <div className="op"><strong>{op}</strong><span>{s.view!.card.name} – {formatLabel(s.view!.format)}</span></div>
        <div className="pct">{pct}<small>%</small></div>
      </div>
      {r.mapNames > 0 && (
        <div className="rail">
          <span className={`step ${r.phase === "map-names" ? "on" : "ok"}`}><i>{r.phase === "map-names" ? "1" : "✓"}</i>Tên khu vực ({r.mapNames})</span>
          <span className="line" />
          <span className={`step ${r.phase === "main" ? "on" : ""}`}><i>2</i>Nội dung còn lại</span>
        </div>
      )}
      <div className="neon" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
      <div className="stats">
        <div className="stat"><div className="k"><I id="i-text" />Số câu</div><div className="v">{fmt(r.overallDone)}</div><div className="s">trên {r.overallTotal ? fmt(r.overallTotal) : "…"} câu</div></div>
        <div className="stat"><div className="k"><I id="i-clock" />Còn lại (ước tính)</div>
          <div className="v">{waiting ? "Đang chờ" : r.overallDone < Math.max(1, r.overallTotal * 0.02) ? "Đang tính..." : `~${duration(r.etaMs)}`}</div>
          <div className="s">đã chạy {duration(elapsed)}</div></div>
        <div className="stat"><div className="k"><I id="i-cpu" />Engine</div><div className="v" style={{ fontSize: 15, paddingTop: 3 }}>{r.engine || "…"}</div>
          <div className="s">{paid ? "trả phí" : "miễn phí"}</div></div>
        <div className={`stat ${paid ? "paid" : ""}`}><div className="k"><I id="i-coin" />Chi phí</div>
          <div className="v">{paid ? usd(r.costUsd) : "$0"}</div>
          <div className="s">{paid ? (r.maxCost ? `giới hạn ${usd(r.maxCost)}` : "không giới hạn") : "engine miễn phí"}</div></div>
      </div>
      <div className="run-foot">
        <span className="msg">{r.stopping ? <><Spinner />Chờ lô đang dịch xong rồi lưu lại...</>
          : waiting ? <><I id="i-alert" size="sm" />Chờ bạn trả lời hộp thoại</> : "Mỗi lô dịch xong được lưu ngay, dừng giữa chừng không mất."}</span>
        <button className="btn danger" onClick={stop} disabled={r.stopping}>{r.stopping ? <><Spinner />Đang dừng</> : <><I id="i-stop" />Dừng</>}</button>
      </div>
    </div>
  );
}

function ResultPanel() {
  const s = useApp();
  const r = s.result!;
  const done = r.status === "done";
  const total = r.files.reduce((n, f) => n + f.lines, 0);
  const handled = r.files.reduce((n, f) => n + f.translated + f.kept, 0);
  const pct = total ? Math.floor((handled / total) * 100) : 0;
  const errLines = s.view?.errorLines ?? 0;
  const paid = r.engines.find(u => u.paid);
  return <>
    <div className={`run finished ${done ? "ok" : ""}`}>
      <div className="run-head">
        <div className="op"><strong>{done ? (r.errorCount ? `Đã dịch xong – ${fmt(r.errorCount)} dòng giữ bản gốc` : "Đã dịch xong") : "Đã dừng – phần đã dịch vẫn được lưu"}</strong><span>Sau {duration(r.elapsedMs)}</span></div>
        <div className="pct">{pct}<small>%</small></div>
      </div>
      <div className="neon"><i style={{ width: `${pct}%` }} /></div>
      {r.stopReason && <Notice tone={/chi phí|credit/i.test(r.stopReason) ? "warning" : "info"}>
        <b>Lý do dừng:</b> {r.stopReason}. Bấm <b>Dịch tiếp</b> để dịch phần còn lại – câu đã dịch không bị dịch lại.
      </Notice>}
      <div className="result-list">
        {r.engines.map(u => (
          <div className="result-row" key={u.engine}><span>{u.engine}</span>
            <b>{fmt(u.sentences)} câu{u.paid && u.tokensIn !== undefined ? ` – ${fmt(u.tokensIn)} token vào / ${fmt(u.tokensOut ?? 0)} token ra – ${u.costUsd !== undefined ? `≈ ${usd(u.costUsd)}` : "chưa có giá trong config.json"}` : " – $0"}</b></div>
        ))}
        {r.engines.length === 0 && <div className="result-row"><span>Câu mới dịch</span><b>0 (đã có hết trong memory)</b></div>}
        {r.fallbackUsed > 0 && <div className="result-row"><span>AI không dịch, đã dùng Google</span><b>{fmt(r.fallbackUsed)} câu</b></div>}
        {r.failed > 0 && <div className="result-row"><span>Không engine nào dịch được (giữ bản gốc)</span><b>{fmt(r.failed)} câu</b></div>}
        {r.untranslated > 0 && <div className="result-row"><span>Đoạn chưa dịch (giữ bản gốc)</span><b>{fmt(r.untranslated)}</b></div>}
        <div className="result-row"><span>Lỗi mã điều khiển (giữ bản gốc)</span>
          <b style={{ display: "flex", alignItems: "center", gap: 10 }}>{fmt(r.errorCount)} dòng
            {errLines > 0 && <button className="btn sm" onClick={() => setState({ stage: "errors", errors: null })}><I id="i-alert" size="sm" />Xem và sửa</button>}</b></div>
        <div className="result-row"><span>Đã ghi vào bản dịch</span><b>{r.files.length} file</b></div>
        {r.fontApplied && <div className="result-row"><span>Font Doctor</span><b>Đã áp {r.fontApplied}</b></div>}
      </div>
      {paid && r.pricedPaid && <p className="hint" style={{ margin: 0 }}>Chi phí là ước tính theo bảng giá trong config.json – số chính xác xem trên trang quản lý API.</p>}
      <div className="run-foot" style={{ gap: 8 }}>
        {done ? <button className="btn ghost" style={{ marginLeft: 0 }} onClick={() => setState({ stage: "idle" })}><I id="i-left" />Quay lại</button>
          : <button className="btn" style={{ marginLeft: 0 }} onClick={translate}><I id="i-play" />Dịch tiếp</button>}
        <button className="btn primary" style={{ marginLeft: "auto" }} onClick={exportPreview}><I id="i-export" />Chép vào game</button>
      </div>
    </div>
    {s.view?.format.note && <Notice tone="info">{s.view.format.note}</Notice>}
  </>;
}

// ---------------------------------------------------------------- nhật ký
const LOG_ICON: Record<LogLine["level"], IconId> = { info: "i-info", warn: "i-alert", error: "i-x-circle", success: "i-check-circle" };
const hhmm = (t: number) => new Date(t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

function LogPanel() {
  const { log } = useApp();
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }, [log, open]);
  const last = log.at(-1);
  const lvl = { info: "info", warn: "warn", error: "error", success: "success" } as const;
  return (
    <div className={`log ${open ? "open" : ""}`}>
      <div className="log-head">
        <button className="tgl" aria-expanded={open} onClick={() => setOpen(!open)}><I id="i-chev-down" size="sm" className="chev" />Nhật ký</button>
        <span className="last">{last ? `${hhmm(last.t)}  ${last.text}` : "Chưa có hoạt động"}</span>
      </div>
      <div className="log-body" ref={body}>
        {log.length === 0 && <div className="muted" style={{ padding: "6px 0" }}>Chưa có hoạt động</div>}
        {log.map((l, i) => (
          <div key={i} className={`log-line ${lvl[l.level]}`}><time>{hhmm(l.t)}</time><I id={LOG_ICON[l.level]} /><span>{l.text}</span></div>
        ))}
      </div>
    </div>
  );
}
