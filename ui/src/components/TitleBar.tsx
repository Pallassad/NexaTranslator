import { useEffect, useState } from "react";
import type { GameCard } from "../../../shared/api";
import { openGame } from "../lib/actions";
import { go, useApp, type Screen } from "../lib/store";
import type { ThemePref } from "../lib/theme";
import { GameIcon, usePopover } from "./common";
import { gameStatus } from "../lib/format";
import { I, type IconId } from "./Icon";

/**
 * Thanh tiêu đề tự vẽ (cửa sổ không viền). Vùng trống kéo được cửa sổ (-webkit-app-region: drag),
 * mọi nút / tab đặt no-drag để bấm không bị nhầm thành kéo.
 */
export function TitleBar({ theme }: { theme: { pref: ThemePref; choose: (p: ThemePref) => void; systemDark: boolean } }) {
  const s = useApp();
  const [maxed, setMaxed] = useState(false);
  useEffect(() => window.nexa.window.onMaximized(setMaxed), []);
  const themePop = usePopover();
  const gamePop = usePopover();
  const [games, setGames] = useState<GameCard[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (gamePop.open && s.tool) window.nexa.library.list(s.tool.id).then(setGames).catch(() => setGames([]));
  }, [gamePop.open, s.tool, s.libVersion]);

  const atTools = s.screen === "tools";
  const gameName = s.view?.card.name ?? (s.gameId ? "Đang mở..." : "Thư viện");
  const tabs: { id: Screen; label: string; icon: IconId }[] = [
    { id: "translate", label: "Dịch", icon: "i-translate" },
    { id: "glossary", label: "Glossary", icon: "i-book" },
    { id: "font", label: "Font", icon: "i-type" },
  ];
  const themeIcon: Record<ThemePref, IconId> = { light: "i-sun", dark: "i-moon", system: "i-monitor" };

  return (
    <header className="titlebar">
      <button className="brand" title="Về Menu công cụ" onClick={() => go("tools")}>
        <svg className="logo"><use href="#logo" /></svg>Nexa
      </button>
      {!atTools && s.tool && (
        <button className="crumb-tool" style={{ display: "flex" }} title={`Mở thư viện game ${s.tool.name}`} onClick={() => go("library")}
          aria-current={s.screen === "library" ? "page" : undefined}>
          <I id="i-sword" size="sm" />{s.tool.name}
        </button>
      )}

      {!atTools && s.tool && (
        <nav className="tool-nav" aria-label="Điều hướng công cụ" style={{ display: "flex" }}>
          <div ref={gamePop.ref} style={{ position: "relative" }}>
            <button className="game-switch" aria-haspopup="menu" aria-expanded={gamePop.open} title="Chọn game"
              onClick={() => gamePop.setOpen(!gamePop.open)}>
              <I id="i-folder" size="sm" /><span className="name">{gameName}</span><I id="i-chev-down" size="sm" />
            </button>
            <div className={`popover ${gamePop.open ? "open" : ""}`} role="menu" style={{ left: 0, top: 40, width: 310 }}>
              <div className="pop-search search"><I id="i-search" size="sm" />
                <input className="input" placeholder="Tìm game..." value={q} onChange={e => setQ(e.target.value)} style={{ height: 32 }} autoFocus />
              </div>
              <div className="menu-title">Game của {s.tool.name}</div>
              {games.filter(g => g.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8).map(g => (
                <button key={g.id} className="menu-item" aria-checked={g.id === s.gameId}
                  onClick={() => { gamePop.setOpen(false); openGame(g.id); }}>
                  <GameIcon game={g} size={28} />
                  <span>{g.name}<span className="sub">{progressText(g, s.run?.gameId)}</span></span>
                  <I id="i-check" size="sm" className="check" />
                </button>
              ))}
              {games.length === 0 && <div className="menu-title" style={{ padding: 10 }}>Chưa có game nào</div>}
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => { gamePop.setOpen(false); go("library"); }}><I id="i-folder" />Mở thư viện game</button>
            </div>
          </div>
          <div role="tablist" style={{ display: "flex", height: "100%" }}>
            {tabs.map(t => (
              <button key={t.id} className="tab" role="tab" aria-selected={s.screen === t.id} onClick={() => go(t.id)}>
                <I id={t.icon} size="sm" /><span className="lbl">{t.label}</span>
                {t.id === "translate" && s.run && <span className="run-dot" title="Đang dịch" />}
              </button>
            ))}
          </div>
        </nav>
      )}
      <button className="tb-btn" title="Cài đặt" aria-pressed={s.screen === "settings"} onClick={() => go("settings")}><I id="i-gear" /></button>

      <div className="drag-space" />

      <div ref={themePop.ref} style={{ position: "relative" }}>
        <button className="tb-btn" title="Giao diện sáng/tối" aria-haspopup="menu" aria-expanded={themePop.open}
          onClick={() => themePop.setOpen(!themePop.open)} style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <I id={themeIcon[theme.pref]} />
        </button>
        <div className={`popover ${themePop.open ? "open" : ""}`} role="menu" style={{ right: 0, top: 40 }}>
          {(["light", "dark", "system"] as ThemePref[]).map(p => (
            <button key={p} className="menu-item" role="menuitemradio" aria-checked={theme.pref === p}
              onClick={() => { theme.choose(p); themePop.setOpen(false); }}>
              <I id={themeIcon[p]} />
              {p === "system"
                ? <span>Theo Windows<span className="sub">Windows đang: {theme.systemDark ? "tối" : "sáng"}</span></span>
                : p === "light" ? "Sáng" : "Tối"}
              <I id="i-check" size="sm" className="check" />
            </button>
          ))}
        </div>
      </div>
      <div className="winctl">
        <button title="Thu nhỏ" onClick={() => window.nexa.window.minimize()}><I id="i-min" size="sm" /></button>
        <button title={maxed ? "Thu về" : "Phóng to"} onClick={() => window.nexa.window.toggleMaximize()}><I id="i-max" size="sm" /></button>
        <button className="close" title="Đóng" onClick={() => window.nexa.window.close()}><I id="i-x" size="sm" /></button>
      </div>
    </header>
  );
}

export function progressText(g: GameCard, runningId?: string | null): string {
  if (!g.available) return "Không tìm thấy thư mục game";
  const st = gameStatus(g, runningId);
  if (st === "running") return "Đang dịch...";
  if (st === "none") return "Chưa dịch";
  if (st === "done") return "Đã dịch xong";
  return `Đã dịch ${Math.floor(((g.progress!.translated + g.progress!.kept) / g.progress!.lines) * 100)}%`;
}
