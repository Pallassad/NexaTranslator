import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GameCard } from "../../../shared/api";
import { useApp, setState } from "../lib/store";
import { I, type IconId } from "./Icon";

/** Ảnh icon.png của game; game không có icon → icon mặc định (không tự vẽ ảnh giả). */
export function GameIcon({ game, size = 64 }: { game: Pick<GameCard, "id" | "iconPath" | "name">; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, borderRadius: Math.round(size / 4.5) };
  if (game.iconPath && !failed) {
    return <img className="icon" style={style} src={`nexa-icon://game/${encodeURIComponent(game.id)}`} alt="" onError={() => setFailed(true)} />;
  }
  return (
    <div className="gi" style={{ ...style, background: "var(--elev)", color: "var(--text3)", border: "1px solid var(--border)" }}>
      <I id="i-sword" size={size > 40 ? "lg" : "sm"} />
    </div>
  );
}

/** Đóng popover khi bấm ra ngoài hoặc Esc. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

/** Khung hộp thoại: nền mờ, Esc / bấm Hủy để đóng. */
export function Dialog({ icon, tone = "accent", title, desc, children, footer, wide, onClose }: {
  icon: IconId; tone?: "accent" | "warning" | "error" | "info"; title: ReactNode; desc?: ReactNode;
  children?: ReactNode; footer: ReactNode; wide?: boolean; onClose?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !onClose) return;
      // Nhiều hộp thoại chồng nhau → Esc chỉ đóng hộp trên cùng
      const open = document.querySelectorAll(".dialog.open");
      if (open[open.length - 1] === box.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    // Đưa focus vào ô nhập / nút chính
    setTimeout(() => (box.current?.querySelector<HTMLElement>("input:not([type=checkbox]), .btn.primary:not(:disabled)") ?? box.current?.querySelector<HTMLElement>("button"))?.focus(), 30);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim open">
      <div className={`dialog open ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" ref={box}>
        <div className="dlg-head">
          <div className={`ic ${tone}`}><I id={icon} /></div>
          <div><h2>{title}</h2>{desc && <p>{desc}</p>}</div>
        </div>
        {children && <div className="dlg-body">{children}</div>}
        <div className="dlg-foot">{footer}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  const icon: Record<string, IconId> = { success: "i-check-circle", warning: "i-alert", error: "i-x-circle", info: "i-info" };
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`} role={t.type === "error" ? "alert" : undefined}
          onClick={() => setState(s => ({ toasts: s.toasts.filter(x => x.id !== t.id) }))}>
          <I id={icon[t.type]} />
          <div><b>{t.title}</b>{t.text && <span>{t.text}</span>}</div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon = "i-folder", title, children, action, flat }: {
  icon?: IconId; title: string; children?: ReactNode; action?: ReactNode; flat?: boolean;
}) {
  return (
    <div className={`empty ${flat ? "flat" : ""}`}>
      {!flat && <div className="ic"><I id={icon} size="lg" /></div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Spinner({ large }: { large?: boolean }) {
  return <span className={`spinner ${large ? "lg" : ""}`} />;
}

export function Notice({ tone, children }: { tone: "info" | "warning" | "error" | "success"; children: ReactNode }) {
  const icon: Record<string, IconId> = { info: "i-info", warning: "i-alert", error: "i-x-circle", success: "i-check-circle" };
  return <div className={`notice ${tone}`}><I id={icon[tone]} /><div>{children}</div></div>;
}
