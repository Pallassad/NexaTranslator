import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActorNamesView, GlossarySaveResult, GlossaryView, NameLang, NameMethod, UserGlossaryInput,
} from "../../../shared/api";
import { Empty, Notice, Spinner } from "../components/common";
import { I } from "../components/Icon";
import { applyView, handleError } from "../lib/actions";
import { errMsg, fmt } from "../lib/format";
import { go, toast, useApp } from "../lib/store";

type Tab = "names" | "terms" | "all";

/** Màn 4 – Glossary: đổi tên nhân vật, sửa thuật ngữ / tên giữ nguyên, xem toàn bộ. */
export function GlossaryScreen() {
  const s = useApp();
  const [data, setData] = useState<GlossaryView | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("names");
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async (notify = false) => {
    if (!s.gameId) return;
    setLoading(true);
    try {
      setData(await window.nexa.game.glossary(s.gameId));
      if (notify) toast("success", "Đã tải lại glossary");
    } catch (e) {
      handleError(e, "Không đọc được glossary");
    } finally {
      setLoading(false);
    }
  }, [s.gameId]);
  useEffect(() => { setData(null); load(); }, [load]);

  if (!s.gameId) {
    return <div className="page"><Empty title="Chọn game trước"
      action={<button className="btn primary" onClick={() => go("library")}><I id="i-folder" />Mở thư viện game</button>}>
      Glossary là dữ liệu riêng của từng game. Mở một game trong thư viện để xem.
    </Empty></div>;
  }

  const switchTab = (t: Tab) => {
    if (t === tab) return;
    if (dirty && !confirm("Bạn có thay đổi chưa lưu. Bỏ thay đổi và chuyển tab?")) return;
    setDirty(false);
    setTab(t);
  };

  const openFile = () => window.nexa.game.openGlossaryFile(s.gameId!)
    .then(() => toast("info", "Đã mở glossary.json", "Sửa xong, lưu file rồi bấm Tải lại."))
    .catch(e => toast("error", "Không mở được file", errMsg(e)));

  /** Sau khi lưu: cập nhật thư viện + báo bước tiếp theo. */
  const saved = (r: GlossarySaveResult, what: string) => {
    applyView(r.view);
    load();
    if (r.pending > 0) {
      toast("warning", `Đã lưu ${what} – còn ${fmt(r.pending)} câu cần dịch`, "Vào tab Dịch, bấm Dịch tiếp rồi Chép vào game.");
    } else if (r.rewritten) {
      toast("success", `Đã lưu ${what} và cập nhật bản dịch`, "Bấm Chép vào game ở tab Dịch để game nhận thay đổi.");
    } else {
      toast("success", `Đã lưu ${what}`, "Thay đổi sẽ áp dụng khi bạn dịch game.");
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Glossary</h1>
          <p>Tên nhân vật, tên giữ nguyên và thuật ngữ dịch cố định của <b>{s.view?.card.name}</b>.</p>
        </div>
        <button className="btn" onClick={() => load(true)} disabled={loading}>{loading ? <Spinner /> : <I id="i-refresh" />}Tải lại</button>
        <button className="btn" onClick={openFile}><I id="i-external" />Mở file glossary.json</button>
      </div>
      <div className="seg gl-tabs" role="tablist" aria-label="Phần glossary">
        {([["names", "i-user", "Tên nhân vật"], ["terms", "i-book", "Thuật ngữ & giữ nguyên"], ["all", "i-eye", "Xem toàn bộ"]] as const).map(([k, icon, l]) => (
          <button key={k} role="tab" aria-pressed={tab === k} aria-selected={tab === k} onClick={() => switchTab(k)}><I id={icon} size="sm" />{l}</button>
        ))}
      </div>
      {!data ? (
        <div className="loading-page" style={{ height: 300 }}><Spinner large /><span>Đang đọc glossary...</span></div>
      ) : tab === "names" ? (
        <NamesPanel gameId={s.gameId} width={s.width ?? undefined} onDirty={setDirty} onSaved={r => saved(r, "tên nhân vật")} />
      ) : tab === "terms" ? (
        <TermsPanel key={JSON.stringify(data.user)} data={data} gameId={s.gameId} width={s.width ?? undefined}
          onDirty={setDirty} onSaved={r => saved(r, "glossary")} />
      ) : (
        <AllPanel data={data} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tên nhân vật
// ---------------------------------------------------------------------------

const LANGS: [NameLang, string][] = [["ja", "Tiếng Nhật → Romaji"], ["zh", "Tiếng Trung → Hán Việt"], ["latin", "Chữ Latin (giữ nguyên)"]];
const METHOD: Record<NameMethod | "manual" | "saved", [string, string]> = {
  latin: ["m-keep", "Giữ nguyên"], kana: ["m-auto", "Romaji"], google: ["m-auto", "Cách đọc Google"],
  hanviet: ["m-auto", "Hán Việt"], none: ["m-warn", "Cần tự nhập"], manual: ["m-manual", "Tự sửa"], saved: ["m-saved", "Đã lưu"],
};

interface NameRow { source: string; ids: number[]; saved: string; value: string; method?: NameMethod | "manual"; note?: string }

function NamesPanel({ gameId, width, onDirty, onSaved }: {
  gameId: string; width?: number; onDirty: (d: boolean) => void; onSaved: (r: GlossarySaveResult) => void;
}) {
  const [view, setView] = useState<ActorNamesView | null>(null);
  const [rows, setRows] = useState<NameRow[]>([]);
  const [lang, setLang] = useState<NameLang>("ja");
  const [busy, setBusy] = useState<"suggest" | "save" | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const v = await window.nexa.game.actorNames(gameId);
      setView(v);
      setLang(v.detected);
      // Tên trùng (vd 2 nhân vật cùng tên) gộp thành 1 dòng
      const by = new Map<string, NameRow>();
      for (const a of v.actors) {
        const r = by.get(a.source);
        if (r) r.ids.push(a.id);
        else by.set(a.source, { source: a.source, ids: [a.id], saved: a.current, value: a.current });
      }
      setRows([...by.values()]);
    } catch (e) {
      handleError(e, "Không đọc được tên nhân vật");
    }
  }, [gameId]);
  useEffect(() => { load(); }, [load]);

  const dirty = rows.some(r => r.value.trim() !== r.saved);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  const edit = (source: string, value: string) =>
    setRows(rs => rs.map(r => (r.source === source ? { ...r, value, method: "manual", note: undefined } : r)));

  const suggest = async (overwrite: boolean) => {
    const targets = rows.filter(r => overwrite || !r.value.trim());
    if (!targets.length) { toast("info", "Mọi tên đã có", "Bấm “Gợi ý lại tất cả” để tạo lại."); return; }
    setBusy("suggest");
    try {
      const res = await window.nexa.game.suggestNames(targets.map(r => r.source), lang);
      const by = new Map(res.map(x => [x.source, x]));
      setRows(rs => rs.map(r => {
        const x = by.get(r.source.trim());
        if (!x || !(overwrite || !r.value.trim())) return r;
        return { ...r, value: x.suggestion, method: x.method, note: x.note };
      }));
      const missing = res.filter(x => x.method === "none").length;
      if (missing) toast("warning", `${missing} tên chưa có gợi ý`, "Những ô ghi “Cần tự nhập” – gõ tên bạn muốn, hoặc để trống để giữ tên gốc.");
      else toast("success", `Đã gợi ý ${res.length} tên`, "Xem lại rồi bấm Lưu tên.");
    } catch (e) {
      handleError(e, "Không tạo được gợi ý");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      const names = Object.fromEntries(rows.map(r => [r.source, r.value]));
      const r = await window.nexa.game.saveActorNames(gameId, width, names);
      onSaved(r);
      await load();
    } catch (e) {
      handleError(e, "Không lưu được tên");
    } finally {
      setBusy(null);
    }
  };

  if (!view) return <div className="loading-page" style={{ height: 240 }}><Spinner large /><span>Đang đọc tên nhân vật...</span></div>;
  if (!rows.length) {
    return <Empty flat icon="i-user" title="Game không có tên nhân vật">
      Không tìm thấy nhân vật nào trong {view.file}.
    </Empty>;
  }

  const ql = q.trim().toLowerCase();
  const list = rows.filter(r => `${r.source} ${r.value}`.toLowerCase().includes(ql));
  const changed = rows.filter(r => r.value.trim() && r.value.trim() !== r.source).length;
  const detectedLabel = LANGS.find(l => l[0] === view.detected)?.[1];

  return <>
    <Notice tone="info">
      Đổi tên trong <b>{view.file}</b> sang chữ đọc được: tên tiếng Anh giữ nguyên, tiếng Nhật → <b>Romaji</b> (さとう → Sato),
      tiếng Trung → <b>Hán Việt</b> (李白 → Lý Bạch). Tên mới dùng ở menu, màn trạng thái, mã <span className="code">\N[n]</span>,
      tên người nói và trong câu thoại. Ô để trống = giữ tên gốc.
    </Notice>
    <div className="gl-tools" style={{ marginTop: 16 }}>
      <div className="search"><I id="i-search" size="sm" /><input className="input" placeholder="Tìm tên..." value={q} onChange={e => setQ(e.target.value)} /></div>
      <label className="lang-pick">
        <span className="muted">Ngôn ngữ gốc</span>
        <select className="select" value={lang} onChange={e => setLang(e.target.value as NameLang)} aria-label="Ngôn ngữ gốc của tên">
          {LANGS.map(([k, l]) => <option key={k} value={k}>{l}{k === view.detected ? " (tự nhận)" : ""}</option>)}
        </select>
      </label>
      <div className="grow" />
      <button className="btn" disabled={!!busy} onClick={() => suggest(true)} title="Tạo lại gợi ý cho mọi tên (ghi đè ô đã sửa)">
        <I id="i-refresh" size="sm" />Gợi ý lại tất cả
      </button>
      <button className="btn" disabled={!!busy} onClick={() => suggest(false)}>
        {busy === "suggest" ? <Spinner /> : <I id="i-wand" size="sm" />}Gợi ý cho ô trống
      </button>
      <button className="btn primary" disabled={!!busy || !dirty} onClick={save}>
        {busy === "save" ? <Spinner /> : <I id="i-check" size="sm" />}Lưu tên
      </button>
    </div>
    {lang !== view.detected && (
      <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>Nexa nhận game này là <b>{detectedLabel}</b> – bạn đang chọn khác.</p>
    )}
    <div className="tbl-wrap">
      <table className="tbl names-tbl">
        <thead><tr><th style={{ width: 70 }}>ID</th><th style={{ width: "26%" }}>Tên gốc</th><th>Tên mới</th><th style={{ width: 170 }}>Cách tạo</th></tr></thead>
        <tbody>
          {list.map(r => {
            const m = r.method ?? (r.saved && r.value === r.saved ? "saved" : undefined);
            return (
              <tr key={r.source}>
                <td className="muted num">{r.ids.join(", ")}</td>
                <td><b className="src-name">{r.source}</b></td>
                <td>
                  <div className="name-edit">
                    <input className="input" value={r.value} placeholder={r.source} aria-label={`Tên mới cho ${r.source}`}
                      onChange={e => edit(r.source, e.target.value)} />
                    {r.value !== r.saved && (
                      <button className="btn ghost sm icon-only" title="Hoàn tác về tên đã lưu" aria-label="Hoàn tác"
                        onClick={() => setRows(rs => rs.map(x => (x.source === r.source ? { ...x, value: x.saved, method: undefined, note: undefined } : x)))}>
                        <I id="i-restore" size="sm" />
                      </button>
                    )}
                  </div>
                  {r.note && <div className="name-note">{r.note}</div>}
                </td>
                <td>{m ? <span className={`m-pill ${METHOD[m][0]}`}>{METHOD[m][1]}</span> : <span className="muted">Giữ tên gốc</span>}</td>
              </tr>
            );
          })}
          {list.length === 0 && <tr><td colSpan={4}><Empty flat title="Không có tên khớp">Thử từ khóa khác.</Empty></td></tr>}
        </tbody>
      </table>
    </div>
    <p className="hint" style={{ marginTop: 12 }}>
      {fmt(rows.length)} tên · {fmt(changed)} tên đổi. Sau khi lưu: vào tab Dịch bấm <b>Dịch tiếp</b> (nếu Nexa báo còn câu cần dịch) rồi
      {" "}<b>Chép vào game</b>. Save cũ vẫn giữ tên cũ – nên chơi <b>New Game</b>. Khôi phục bản gốc sẽ trả lại tên gốc.
    </p>
  </>;
}

// ---------------------------------------------------------------------------
// Thuật ngữ & giữ nguyên (sửa được)
// ---------------------------------------------------------------------------

interface TermRow { id: number; source: string; target: string }

function TermsPanel({ data, gameId, width, onDirty, onSaved }: {
  data: GlossaryView; gameId: string; width?: number; onDirty: (d: boolean) => void; onSaved: (r: GlossarySaveResult) => void;
}) {
  const init = useMemo(() => Object.entries(data.user.terms).map(([source, target], id) => ({ id, source, target })), [data]);
  const [terms, setTerms] = useState<TermRow[]>(init);
  const [keep, setKeep] = useState<string[]>(data.user.keep);
  const [translate, setTranslate] = useState<string[]>(data.user.translate);
  const [newKeep, setNewKeep] = useState("");
  const [busy, setBusy] = useState(false);
  const [nextId, setNextId] = useState(init.length);

  const input = (): UserGlossaryInput => ({
    keep, translate, terms: Object.fromEntries(terms.filter(t => t.source.trim() && t.target.trim()).map(t => [t.source.trim(), t.target.trim()])),
  });
  const dirty = JSON.stringify(input()) !== JSON.stringify({ keep: data.user.keep, translate: data.user.translate, terms: data.user.terms });
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  const dupes = new Set(terms.map(t => t.source.trim()).filter((v, i, a) => v && a.indexOf(v) !== i));
  const incomplete = terms.filter(t => Boolean(t.source.trim()) !== Boolean(t.target.trim())).length;

  const addTerm = () => { setTerms(ts => [...ts, { id: nextId, source: "", target: "" }]); setNextId(n => n + 1); };
  const setTerm = (id: number, patch: Partial<TermRow>) => setTerms(ts => ts.map(t => (t.id === id ? { ...t, ...patch } : t)));
  const addKeep = () => {
    const v = newKeep.trim();
    if (!v) return;
    if (!keep.includes(v)) setKeep(k => [...k, v]);
    setNewKeep("");
  };
  // Tên tự giữ nguyên (từ nhân vật) – có thể bỏ ra để dịch
  // (bỏ tên đã đổi ở tab Tên nhân vật – tên đó không còn "giữ nguyên")
  const renamed = new Set(data.terms.filter(t => t.origin === "actor").map(t => t.source));
  const autoNames = [...new Set([...data.autoKeep, ...translate])].filter(n => !renamed.has(n)).sort();

  const save = async () => {
    if (dupes.size) { toast("error", "Có thuật ngữ bị trùng", [...dupes].join(", ")); return; }
    setBusy(true);
    try { onSaved(await window.nexa.game.saveGlossary(gameId, width, input())); }
    catch (e) { handleError(e, "Không lưu được glossary"); }
    finally { setBusy(false); }
  };

  return <>
    <div className="gl-section">
      <div className="gl-sec-head">
        <div className="grow">
          <h3>Thuật ngữ dịch cố định</h3>
          <p className="muted">Chữ gốc luôn được dịch đúng như bạn ghi, cả trong câu thoại. Ví dụ: Strength → Thể lực.</p>
        </div>
        <button className="btn" onClick={addTerm}><I id="i-plus" size="sm" />Thêm thuật ngữ</button>
        <button className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? <Spinner /> : <I id="i-check" size="sm" />}Lưu glossary</button>
      </div>
      <div className="tbl-wrap">
        <table className="tbl terms-tbl">
          <thead><tr><th style={{ width: "42%" }}>Chữ gốc</th><th>Bản dịch cố định</th><th style={{ width: 52 }} /></tr></thead>
          <tbody>
            {terms.map(t => (
              <tr key={t.id} className={dupes.has(t.source.trim()) ? "dupe" : undefined}>
                <td><input className="input" value={t.source} placeholder="vd Strength" aria-label="Chữ gốc"
                  autoFocus={!t.source && !t.target && t.id >= init.length} onChange={e => setTerm(t.id, { source: e.target.value })} /></td>
                <td><input className="input" value={t.target} placeholder="vd Thể lực" aria-label="Bản dịch cố định"
                  onChange={e => setTerm(t.id, { target: e.target.value })}
                  onKeyDown={e => { if (e.key === "Enter") addTerm(); }} /></td>
                <td><button className="btn ghost sm icon-only" title="Xóa" aria-label={`Xóa ${t.source}`}
                  onClick={() => setTerms(ts => ts.filter(x => x.id !== t.id))}><I id="i-trash" size="sm" /></button></td>
              </tr>
            ))}
            {terms.length === 0 && <tr><td colSpan={3}><Empty flat title="Chưa có thuật ngữ">Bấm Thêm thuật ngữ để tạo dòng đầu tiên.</Empty></td></tr>}
          </tbody>
        </table>
      </div>
      {(dupes.size > 0 || incomplete > 0) && (
        <p className="hint warn-text">
          {dupes.size > 0 && <>Chữ gốc bị trùng: {[...dupes].join(", ")}. </>}
          {incomplete > 0 && <>{incomplete} dòng thiếu chữ gốc hoặc bản dịch – sẽ không được lưu.</>}
        </p>
      )}
    </div>

    <div className="gl-section">
      <div className="gl-sec-head">
        <div className="grow">
          <h3>Giữ nguyên, không dịch</h3>
          <p className="muted">Tên riêng, tên chiêu thức... giữ đúng chữ gốc trong mọi câu.</p>
        </div>
      </div>
      <div className="chips">
        {keep.map(k => (
          <span key={k} className="chip">{k}
            <button aria-label={`Bỏ ${k}`} title="Bỏ" onClick={() => setKeep(ks => ks.filter(x => x !== k))}><I id="i-x" size="sm" /></button>
          </span>
        ))}
        <span className="chip-add">
          <input className="input" value={newKeep} placeholder="Thêm tên..." aria-label="Thêm tên giữ nguyên"
            onChange={e => setNewKeep(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addKeep(); }} />
          <button className="btn sm" onClick={addKeep} disabled={!newKeep.trim()}><I id="i-plus" size="sm" />Thêm</button>
        </span>
      </div>
    </div>

    {autoNames.length > 0 && (
      <div className="gl-section">
        <div className="gl-sec-head">
          <div className="grow">
            <h3>Tên Nexa tự giữ nguyên</h3>
            <p className="muted">Lấy từ tên nhân vật. Bỏ chọn tên nào là từ thường cần dịch (vd “Guard”, “Mother”).</p>
          </div>
        </div>
        <div className="chips">
          {autoNames.map(n => {
            const on = !translate.includes(n);
            return (
              <button key={n} className={`chip toggle ${on ? "on" : "off"}`} aria-pressed={on}
                title={on ? "Đang giữ nguyên – bấm để cho dịch" : "Đang cho dịch – bấm để giữ nguyên"}
                onClick={() => setTranslate(t => (on ? [...t, n] : t.filter(x => x !== n)))}>
                <I id={on ? "i-lock" : "i-translate"} size="sm" />{n}
              </button>
            );
          })}
        </div>
      </div>
    )}
    <p className="hint">
      Đổi bản dịch của thuật ngữ có sẵn: không cần dịch lại. Thêm thuật ngữ / tên mới: các câu chứa nó sẽ được dịch lại khi bấm Dịch tiếp.
    </p>
  </>;
}

// ---------------------------------------------------------------------------
// Xem toàn bộ (chỉ đọc)
// ---------------------------------------------------------------------------

type Kind = "all" | "keep" | "term" | "map" | "actor";
interface Row { source: string; target: string; kind: Exclude<Kind, "all">; origin: string }

function AllPanel({ data }: { data: GlossaryView }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const autoKeep = new Set(data.autoKeep);
  const rows: Row[] = [
    ...data.keep.map(k => ({ source: k, target: "", kind: "keep" as const, origin: autoKeep.has(k) ? "Tên nhân vật (tự động)" : "Bạn thêm" })),
    ...data.terms.map(t => ({
      source: t.source, target: t.target,
      kind: t.origin === "map" ? "map" as const : t.origin === "actor" ? "actor" as const : "term" as const,
      origin: t.origin === "user" ? "Bạn thêm" : t.origin === "global" ? "Glossary chung" : t.origin === "actor" ? "Tên nhân vật đã đổi" : "Tự đồng bộ từ tên bản đồ",
    })),
    ...data.mapNotYet.map(m => ({ source: m, target: "", kind: "map" as const, origin: "Tự đồng bộ từ tên bản đồ" })),
  ];
  const count = (k: Kind) => (k === "all" ? rows.length : rows.filter(r => r.kind === k).length);
  const ql = q.trim().toLowerCase();
  const list = rows.filter(r => (kind === "all" || r.kind === kind) && `${r.source} ${r.target}`.toLowerCase().includes(ql));
  const TYPE = {
    keep: ["type-keep", "Giữ nguyên"], term: ["type-term", "Dịch cố định"], map: ["type-map", "Tên khu vực"], actor: ["type-actor", "Tên nhân vật"],
  } as const;

  return <>
    <div className="gl-tools">
      <div className="search"><I id="i-search" size="sm" /><input className="input" placeholder="Tìm chữ gốc hoặc bản dịch..." value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="seg" role="group" aria-label="Lọc loại">
        {([["all", "Tất cả"], ["actor", "Tên nhân vật"], ["keep", "Giữ nguyên"], ["term", "Dịch cố định"], ["map", "Tên khu vực"]] as [Kind, string][]).map(([k, l]) => (
          <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{l} <span className="muted num">{count(k)}</span></button>
        ))}
      </div>
    </div>
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th style={{ width: "32%" }}>Chữ gốc</th><th style={{ width: "32%" }}>Bản dịch</th><th>Loại</th><th>Nguồn</th></tr></thead>
        <tbody>
          {list.slice(0, 1000).map(r => (
            <tr key={`${r.kind}:${r.source}`}>
              <td><b style={{ fontWeight: 600 }}>{r.source}</b></td>
              <td>{r.kind === "keep" ? <span className="muted">Không dịch</span> : r.target || <span className="badge warning">Sẽ dịch khi bấm Dịch</span>}</td>
              <td><span className={`type-pill ${TYPE[r.kind][0]}`}>{TYPE[r.kind][1]}</span></td>
              <td className="muted">{r.origin}</td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr><td colSpan={4}><Empty flat title={rows.length ? "Không có mục khớp" : "Glossary trống"}>
              {rows.length ? "Thử từ khóa khác hoặc chọn loại khác." : "Thêm tên nhân vật hoặc thuật ngữ ở hai tab bên cạnh."}
            </Empty></td></tr>
          )}
        </tbody>
      </table>
    </div>
    {list.length > 1000 && <p className="hint">Đang hiện 1.000 / {fmt(list.length)} mục – dùng ô tìm kiếm để thu hẹp.</p>}
  </>;
}
