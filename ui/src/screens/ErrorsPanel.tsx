import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ErrorItem, ErrorSegment } from "../../../shared/api";
import { Empty, Notice, Spinner } from "../components/common";
import { I } from "../components/Icon";
import { applyView, handleError } from "../lib/actions";
import { fmt, usd } from "../lib/format";
import { addLog, getState, setState, toast, useApp } from "../lib/store";

/**
 * Màn "Dòng lỗi": bản dịch máy làm mất / lặp mã điều khiển → Nexa đã giữ câu gốc.
 * Người dùng: tự gõ bản dịch (kiểm tra đủ mã khi gõ), giữ bản gốc, hoặc nhờ AI dịch lại.
 */

const PAGE = 20;

/** Mã điều khiển trong chữ gốc (giống src/core/protect.ts, rút gọn để tô màu). */
const CODE_RE = /@ec\([^)]*\)|\\+[A-Za-z]+\[[^\]\n]*\]|\\+[A-Za-z]+<[^>\n]*>|\\[A-Za-z](?![A-Za-z[])|\\[^A-Za-z\s]|<\/?[A-Za-z][^<>\n]{0,30}>|%\d+/g;
const TOKEN_RE = /\{\s*(\d+)\s*\}/g;
/** Token là mã điều khiển (\C[2], <center>, %1, @ec) hay thuật ngữ glossary (tên khu vực, tên nhân vật). */
const isCode = (t: string) => /^(\\|<|%\d|@ec\()/.test(t);

/** Câu lỗi kỹ thuật → câu dễ hiểu. */
export function friendlyReason(r: string): string {
  const m = r.match(/Placeholder \{(\d+)\} \((.+)\) bị (mất|lặp)/);
  if (m) return `${m[3] === "mất" ? "Mất" : "Lặp"} mã ${m[2]}`;
  if (/placeholder lạ/i.test(r)) return "Có mã lạ không có trong câu gốc";
  return r;
}

/** Tô màu mã điều khiển trong chữ gốc. */
function Highlight({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CODE_RE)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push(<span key={m.index} className="code">{m[0]}</span>);
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

/** Bản dịch có {n}: hiện mỗi {n} thành ô màu kèm mã thật. */
function WithTokens({ text, tokens }: { text: string; tokens: string[] }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    const i = Number(m[1]);
    parts.push(<span key={m.index} className={`code ${i < tokens.length ? "" : "bad"}`} title={tokens[i] ?? "mã lạ"}>{tokens[i] ?? m[0]}</span>);
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

/** Đếm số lần xuất hiện của từng {n}; kiểm tra giống restore() ở lõi. */
function checkTokens(text: string, n: number) {
  const used = new Array(n).fill(0);
  let strange = false;
  for (const m of text.matchAll(TOKEN_RE)) {
    const i = Number(m[1]);
    if (i >= n) strange = true; else used[i]++;
  }
  const ok = !strange && used.every(c => c === 1) && text.trim().length > 0;
  return { used, strange, ok };
}

export function ErrorsPanel() {
  const s = useApp();
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const items = s.errors;

  useEffect(() => {
    if (items !== null || !s.gameId) return;
    window.nexa.game.errors(s.gameId, s.width ?? undefined)
      .then(errors => setState({ errors }))
      .catch(e => { handleError(e, "Không đọc được dòng lỗi"); setState({ stage: "idle" }); });
  }, [items, s.gameId, s.width]);

  const ql = q.trim().toLowerCase();
  const list = useMemo(() => (items ?? []).filter(e =>
    !ql || e.source.toLowerCase().includes(ql) || e.file.toLowerCase().includes(ql) ||
    e.segments.some(x => x.translation.toLowerCase().includes(ql))), [items, ql]);

  const back = () => setState({ stage: "idle", errors: null });
  const done = (view: Parameters<typeof applyView>[0], msg: string) => {
    applyView(view);
    setState({ errors: null });                 // tải lại danh sách
    setSelected(new Set());
    addLog("success", msg);
  };

  const keep = async (keys: string[]) => {
    setBusy("keep");
    try {
      const view = await window.nexa.game.keepErrors(s.gameId!, s.width ?? undefined, keys);
      done(view, `Giữ bản gốc cho ${keys.length} đoạn`);
      toast("success", `Đã giữ bản gốc cho ${keys.length} đoạn`, "Game hiện chữ gốc ở những chỗ này.");
    } catch (e) { handleError(e, "Không lưu được"); } finally { setBusy(null); }
  };

  const retranslate = async (keys: string[]) => {
    setBusy("ai");
    try {
      const max = parseFloat(getState().maxCost.replace(",", "."));
      const { result, view } = await window.nexa.game.retranslateErrors(s.gameId!, s.width ?? undefined, keys, Number.isFinite(max) && max > 0 ? max : undefined);
      if (result.cancelled) { toast("info", "Chưa dịch lại", "Bạn không đồng ý dùng engine trả phí."); return; }
      done(view, `AI dịch lại: sửa được ${result.fixed}/${keys.length} đoạn${result.costUsd !== undefined ? ` (~${usd(result.costUsd)})` : ""}`);
      toast(result.stillBroken ? "warning" : "success", `AI sửa được ${result.fixed}/${keys.length} đoạn`,
        result.stillBroken ? `${result.stillBroken} đoạn AI vẫn làm hỏng mã – sửa tay hoặc giữ bản gốc.` : "Bấm Chép vào game để cập nhật game.");
    } catch (e) { handleError(e, "Không dịch lại được"); } finally { setBusy(null); }
  };

  const toggle = (key: string, on: boolean) => setSelected(prev => {
    const n = new Set(prev);
    if (on) n.add(key); else n.delete(key);
    return n;
  });
  const targets = selected.size ? [...selected] : list.map(e => e.key);

  return <>
    <div className="err-head">
      <button className="btn ghost sm" onClick={back}><I id="i-left" size="sm" />Quay lại</button>
      <h2>Dòng lỗi mã điều khiển</h2>
      {items && <span className="badge warning num">{fmt(items.length)} đoạn</span>}
      {(s.view?.reviewedLines ?? 0) > 0 && (
        <button className="btn ghost sm" style={{ marginLeft: "auto" }} disabled={!!busy}
          title="Các đoạn bạn đã chọn giữ bản gốc sẽ quay lại danh sách để sửa"
          onClick={async () => {
            setBusy("unkeep");
            try { done(await window.nexa.game.unkeepErrors(s.gameId!, s.width ?? undefined), "Hiện lại các đoạn đã giữ bản gốc"); }
            catch (e) { handleError(e, "Không hiện lại được"); } finally { setBusy(null); }
          }}>
          <I id="i-refresh" size="sm" />Hiện lại {fmt(s.view!.reviewedLines)} dòng đã giữ gốc
        </button>
      )}
    </div>
    <Notice tone="info">
      Bản dịch máy làm <b>mất hoặc lặp mã</b> như <span className="code">\C[2]</span> (màu chữ), <span className="code">\N[1]</span> (tên nhân vật).
      Nexa đã <b>giữ câu gốc</b> ở những chỗ này để game không lỗi. Sửa bản dịch bên dưới – giữ đủ các ô <span className="code">{"{0}"}</span>, <span className="code">{"{1}"}</span>… mỗi ô đúng 1 lần
      (ô ghi “thuật ngữ” là tên trong glossary, Nexa tự điền đúng bản dịch cố định).
    </Notice>

    {items === null ? (
      <div className="loading-page" style={{ height: 240 }}><Spinner large /><span>Đang tìm dòng lỗi...</span></div>
    ) : items.length === 0 ? (
      <Empty icon="i-check-circle" title="Không còn dòng lỗi nào"
        action={<button className="btn primary" onClick={back}>Quay lại</button>}>
        Mọi đoạn đã được dịch đúng mã hoặc đã chọn giữ bản gốc. Bấm Chép vào game để cập nhật game.
      </Empty>
    ) : <>
      <div className="err-tools">
        <div className="search"><I id="i-search" size="sm" />
          <input className="input" placeholder="Tìm trong câu gốc, bản dịch, tên file..." value={q} onChange={e => { setQ(e.target.value); setShown(PAGE); }} />
        </div>
        <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{selected.size ? `Đã chọn ${selected.size}` : `Áp dụng cho ${list.length} đoạn${ql ? " đang lọc" : ""}`}</span>
        <button className="btn" disabled={!!busy || !targets.length} onClick={() => keep(targets)}>
          {busy === "keep" ? <Spinner /> : <I id="i-check" />}Giữ bản gốc{selected.size ? " (đã chọn)" : " tất cả"}
        </button>
        <button className="btn primary" disabled={!!busy || !targets.length || Boolean(s.run)} onClick={() => retranslate(targets)}
          title="Dùng engine trả phí (AI) – Nexa hỏi trước khi tốn phí">
          {busy === "ai" ? <Spinner /> : <I id="i-cpu" />}Nhờ AI dịch lại{selected.size ? " (đã chọn)" : ""}
        </button>
      </div>
      <div className="err-list">
        {list.slice(0, shown).map(e => (
          <ErrorCard key={e.key} item={e} selected={selected.has(e.key)} disabled={!!busy}
            onSelect={on => toggle(e.key, on)} onKeep={() => keep([e.key])}
            onSaved={view => { done(view, `Đã sửa đoạn trong ${e.file}`); toast("success", "Đã lưu bản dịch", "Bấm Chép vào game để cập nhật game."); }} />
        ))}
      </div>
      {list.length > shown && <button className="btn" style={{ justifySelf: "center" }} onClick={() => setShown(n => n + PAGE)}>Xem thêm {Math.min(PAGE, list.length - shown)} đoạn</button>}
      {list.length === 0 && <Empty flat title={`Không có đoạn khớp “${q}”`} action={<button className="btn sm" onClick={() => setQ("")}>Xóa tìm kiếm</button>} />}
    </>}
  </>;
}

function ErrorCard({ item, selected, disabled, onSelect, onKeep, onSaved }: {
  item: ErrorItem; selected: boolean; disabled: boolean;
  onSelect: (on: boolean) => void; onKeep: () => void; onSaved: (view: Parameters<typeof applyView>[0]) => void;
}) {
  const [drafts, setDrafts] = useState(item.segments.map(x => x.translation));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const checks = drafts.map((d, i) => checkTokens(d, item.segments[i].tokens.length));
  const changed = drafts.some((d, i) => d !== item.segments[i].translation);
  const valid = checks.every(c => c.ok);

  const save = async () => {
    setSaving(true); setErr(null);
    const s = getState();
    try {
      onSaved(await window.nexa.game.fixError(s.gameId!, s.width ?? undefined, item.key, drafts));
    } catch (e) {
      setErr((e as { message?: string }).message ?? String(e));
    } finally { setSaving(false); }
  };

  return (
    <div className={`err-card ${selected ? "selected" : ""}`}>
      <div className="err-top">
        <input type="checkbox" className="cb" checked={selected} onChange={e => onSelect(e.target.checked)} aria-label="Chọn đoạn này" />
        <span className="badge">{item.file}</span>
        {item.lines > 1 && <span className="badge">{item.lines} dòng</span>}
        <span className="badge warning"><I id="i-alert" />{friendlyReason(item.reason)}</span>
      </div>
      <div className="err-row"><span className="lbl">Câu gốc</span><div className="src"><Highlight text={item.source} /></div></div>
      {item.segments.map((seg: ErrorSegment, i) => (
        <div key={i} className="err-seg">
          {item.segments.length > 1 && <div className="hint">Câu {i + 1}/{item.segments.length}{seg.reason ? "" : " – câu này ổn"}</div>}
          <div className="err-row"><span className="lbl">Máy dịch</span>
            <div className="mt"><WithTokens text={seg.translation} tokens={seg.tokens} /></div></div>
          <div className="err-row"><span className="lbl">Sửa thành</span>
            <div style={{ display: "grid", gap: 6 }}>
              <textarea className="input err-input" rows={Math.min(5, Math.max(2, Math.ceil(drafts[i].length / 70)))} value={drafts[i]}
                spellCheck={false} disabled={disabled || saving}
                onChange={e => setDrafts(d => d.map((x, k) => (k === i ? e.target.value : x)))} />
              <div className="tok-legend">
                {seg.tokens.map((t, k) => {
                  const c = checks[i].used[k];
                  return (
                    <button key={k} type="button" className={`tok ${c === 1 ? "ok" : "bad"}`} title="Bấm để chèn vào cuối câu"
                      onClick={() => setDrafts(d => d.map((x, j) => (j === i ? `${x}{${k}}` : x)))}>
                      <b>{`{${k}}`}</b> = {t}{!isCode(t) && <span className="muted"> (thuật ngữ)</span>} {c === 1 ? <I id="i-check" size="sm" /> : <span>{c === 0 ? "thiếu" : `lặp ${c} lần`}</span>}
                    </button>
                  );
                })}
                {checks[i].strange && <span className="tok bad">Có mã lạ</span>}
              </div>
            </div>
          </div>
        </div>
      ))}
      {err && <div className="err-text">{err}</div>}
      <div className="err-actions">
        <button className="btn ghost sm" onClick={onKeep} disabled={disabled || saving}>Giữ bản gốc</button>
        {changed && <button className="btn ghost sm" onClick={() => { setDrafts(item.segments.map(x => x.translation)); setErr(null); }} disabled={saving}>Hoàn tác</button>}
        <button className="btn primary sm" onClick={save} disabled={disabled || saving || !changed || !valid}
          title={!valid ? "Cần đủ mỗi mã đúng 1 lần" : !changed ? "Chưa sửa gì" : ""}>
          {saving ? <Spinner /> : <I id="i-check" size="sm" />}Lưu bản dịch
        </button>
      </div>
    </div>
  );
}
