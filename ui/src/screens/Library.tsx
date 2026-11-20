import { useCallback, useEffect, useState } from "react";
import type { ApiError, GameCard } from "../../../shared/api";
import { Empty, GameIcon, Spinner } from "../components/common";
import { I } from "../components/Icon";
import { openGame } from "../lib/actions";
import { ago, errMsg, fmt, gameStatus, type GameStatus } from "../lib/format";
import { setState, toast, useApp } from "../lib/store";

type Filter = "all" | "progress" | "done" | "none";

/** Lọc "Đang dịch" gồm cả game đang chạy dịch và game dịch dở. */
const matches = (st: GameStatus, f: Filter) => f === "all" || (f === "progress" ? st === "progress" || st === "running" : st === f);

/** Màn 2 – Thư viện game của công cụ đang chọn. */
export function LibraryScreen() {
  const s = useApp();
  const tool = s.tool!;
  const [games, setGames] = useState<GameCard[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [adding, setAdding] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ game: GameCard; x: number; y: number } | null>(null);

  const reload = useCallback(() => {
    window.nexa.library.list(tool.id).then(setGames).catch(e => { setGames([]); toast("error", "Không đọc được thư viện", errMsg(e)); });
  }, [tool.id]);
  useEffect(reload, [reload, s.libVersion]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menu]);

  const add = async (root: string | null) => {
    if (!root) return;
    setAdding(root);
    try {
      const card = await window.nexa.library.add(tool.id, root);
      toast("success", `Đã thêm ${card.name}`, "Bấm vào thẻ game để bắt đầu dịch.");
      setState(st => ({ libVersion: st.libVersion + 1 }));
    } catch (e) {
      const err = e as ApiError;
      setState({ dialog: { kind: "not-game", message: err.message, guess: err.guess, path: root } });
    } finally {
      setAdding(null);
    }
  };
  const pick = async () => add(await window.nexa.library.pickFolder());

  // Kéo thả thư mục vào bất kỳ đâu trong màn hình thư viện
  const [dragging, setDragging] = useState(false);
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragging(true); },
    onDragLeave: (e: React.DragEvent) => { if (e.currentTarget === e.target) setDragging(false); },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) add(window.nexa.library.pathOf(f));
    },
  };

  let list = (games ?? []).filter(g => g.name.toLowerCase().includes(q.trim().toLowerCase()));
  const runningId = s.run?.gameId ?? null;
  if (filter !== "all") list = list.filter(g => matches(gameStatus(g, runningId), filter));
  list = [...list].sort(sort === "name" ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.openedAt - a.openedAt);
  const empty = games !== null && games.length === 0;

  return (
    <div className="page" {...dropProps} style={{ minHeight: "100%" }}>
      <div className="page-head">
        <div className="grow">
          <h1>Thư viện game</h1>
          <p>Game {tool.name} bạn đã thêm. Thêm vào thư viện không sửa gì trong thư mục game.</p>
        </div>
        <button className="btn primary" onClick={pick} disabled={!!adding}><I id="i-folder-plus" />Thêm game</button>
      </div>

      {adding && <div className="notice info" style={{ marginBottom: 16 }}><Spinner /><div>Đang nhận diện <b>{adding}</b>...</div></div>}

      {games === null ? (
        <div className="loading-page" style={{ height: 300 }}><Spinner large /><span>Đang đọc thư viện...</span></div>
      ) : empty ? (
        <Empty icon="i-folder-plus" title="Chưa có game nào"
          action={<button className="btn primary" onClick={pick}><I id="i-folder" />Chọn thư mục game</button>}>
          Kéo thư mục game (thư mục có Game.exe) vào đây, hoặc chọn thư mục. Nexa chỉ đọc, không sửa gì trong game.
        </Empty>
      ) : (
        <>
          <div className="lib-tools">
            <div className="search"><I id="i-search" size="sm" /><input className="input" placeholder="Tìm game..." value={q} onChange={e => setQ(e.target.value)} /></div>
            <div className="seg" role="group" aria-label="Lọc theo trạng thái">
              {([["all", "Tất cả"], ["progress", "Đang dịch"], ["done", "Đã dịch xong"], ["none", "Chưa dịch"]] as [Filter, string][]).map(([f, l]) => (
                <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{l}</button>
              ))}
            </div>
            <select className="select" style={{ marginLeft: "auto" }} aria-label="Sắp xếp" value={sort} onChange={e => setSort(e.target.value as "recent" | "name")}>
              <option value="recent">Mở gần đây</option>
              <option value="name">Tên A–Z</option>
            </select>
          </div>
          <div className="lib-grid">
            {list.map(g => <Card key={g.id} g={g} selected={g.id === s.gameId}
              status={gameStatus(g, runningId)} livePct={g.id === runningId && s.run?.overallTotal ? Math.floor((s.run.overallDone / s.run.overallTotal) * 100) : null}
              onMenu={(x, y) => setMenu({ game: g, x, y })} />)}
            <button className={`add-card ${dragging ? "drag" : ""}`} onClick={pick} disabled={!!adding}>
              <span className="ic"><I id="i-folder-plus" size="lg" /></span>
              <strong>Thêm game</strong>
              <span className="hint">Chọn hoặc kéo thả thư mục game vào đây</span>
            </button>
          </div>
          {list.length === 0 && (
            <Empty flat title="Không tìm thấy game"
              action={<button className="btn" onClick={() => { setQ(""); setFilter("all"); }}>Xóa tìm kiếm</button>}>
              Không có game nào khớp “{q || "bộ lọc"}”.
            </Empty>
          )}
        </>
      )}

      {menu && (
        <div className="popover open" role="menu" style={{ position: "fixed", left: Math.min(menu.x - 220, innerWidth - 240), top: menu.y + 6, width: 220 }}>
          <button className="menu-item" onClick={() => openGame(menu.game.id)}><I id="i-play" />Mở game</button>
          <button className="menu-item" onClick={() => setState({ dialog: { kind: "info", game: menu.game } })}><I id="i-info" />Xem thông tin</button>
          <button className="menu-item" onClick={() => window.nexa.game.openFolder(menu.game.id).catch(e => toast("error", "Không mở được thư mục", errMsg(e)))}><I id="i-folder" />Mở thư mục game</button>
          <div className="menu-sep" />
          <button className="menu-item danger" onClick={() => setState({ dialog: { kind: "remove", game: menu.game } })}><I id="i-x" />Xóa khỏi thư viện</button>
        </div>
      )}
      {dragging && <div className="drop-overlay"><div><I id="i-folder-plus" size="lg" />Thả thư mục game để thêm vào thư viện</div></div>}
    </div>
  );
}

function Card({ g, selected, status: st, livePct, onMenu }: {
  g: GameCard; selected: boolean; status: GameStatus; livePct: number | null; onMenu: (x: number, y: number) => void;
}) {
  const pct = g.progress && g.progress.lines ? Math.floor(((g.progress.translated + g.progress.kept) / g.progress.lines) * 100) : 0;
  const fmtLabel = g.formats.find(f => f.id === g.format)?.id ?? g.formats[0]?.id;
  const open = () => g.available ? openGame(g.id) : toast("warning", "Không tìm thấy thư mục game", g.root);
  return (
    <article className={`game-card ${selected ? "selected" : ""} ${g.available ? "" : "missing"}`} tabIndex={0}
      aria-label={g.name} onClick={open} onKeyDown={e => { if (e.key === "Enter") open(); }}>
      <div className="cover"><GameIcon game={g} /></div>
      <button className="card-more" title="Thao tác khác" aria-label="Thao tác khác"
        onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onMenu(r.right, r.bottom); }}>
        <I id="i-more" />
      </button>
      <div className="game-info">
        <div className="t" title={g.root}>{g.name}</div>
        <div className="badges">
          {g.engine && <span className="badge">RPG Maker {g.engine}</span>}
          {fmtLabel && <span className="badge">{fmtLabel === "rpgm-kns-csv" ? "CSV (KNS)" : "JSON"}</span>}
          {!g.available && <span className="badge warning"><I id="i-alert" />Không thấy thư mục</span>}
        </div>
        <div className="prog">
          {st === "running" ? <><div className="bar"><i style={{ width: `${livePct ?? 0}%` }} /></div><span className="running-label"><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />Đang dịch {livePct ?? 0}%</span></>
            : st === "done" ? <><div className="bar done"><i style={{ width: "100%" }} /></div><span title={g.progress?.kept ? `${fmt(g.progress.kept)} dòng giữ bản gốc vì lỗi mã điều khiển` : undefined}>Xong</span></>
            : st === "progress" ? <><div className="bar"><i style={{ width: `${pct}%` }} /></div><span className="num">{pct}%</span></>
            : <><div className="bar"><i style={{ width: 0 }} /></div><span>Chưa dịch</span></>}
        </div>
        <div className="meta">
          <span>{ago(g.openedAt)}</span>
          {g.exported && <span className="exp" title="Bản dịch đã được chép vào thư mục game"><I id="i-check" size="sm" />Đã chép vào game</span>}
        </div>
      </div>
    </article>
  );
}
