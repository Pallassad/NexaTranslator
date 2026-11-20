import { I, type IconId } from "../components/Icon";
import { setState, toast, useApp } from "../lib/store";

const ICON: Record<string, IconId> = { rpgm: "i-sword", renpy: "i-book-open", unity: "i-box" };
const ADAPTER_HINT: Record<string, string> = { "rpgm-data": "thư mục data/", "rpgm-kns-csv": "thư mục csv/" };
const ADAPTER_LABEL: Record<string, string> = { "rpgm-data": "Dữ liệu JSON", "rpgm-kns-csv": "Bảng CSV (plugin KNS)" };

/** Màn 1 – Menu công cụ. Công cụ chưa làm thì khóa, bấm vào chỉ báo "đang phát triển". */
export function ToolsScreen() {
  const { tools } = useApp();
  const ready = tools.filter(t => t.status === "ready");
  const soon = tools.filter(t => t.status === "soon");

  return (
    <div className="tools-wrap">
      <div className="tools-intro">
        <h1>Bạn muốn dịch game làm bằng gì?</h1>
        <p>Mỗi công cụ hiểu một loại game. Chọn đúng công cụ, Nexa sẽ tự tìm chữ cần dịch trong thư mục game.</p>
      </div>
      <div className="tool-grid">
        {ready.map(t => (
          <button key={t.id} className="tool-card main" onClick={() => setState({ tool: t, screen: "library" })}>
            <div className="top">
              <div className="tool-icon"><I id={ICON[t.id] ?? "i-box"} /></div>
              <span className="badge success"><I id="i-check" />Đang hỗ trợ</span>
            </div>
            <div>
              <h3>{t.name}</h3>
              <p style={{ marginTop: 4 }}>{t.description}</p>
            </div>
            <div className="adapters">
              {t.adapters.map(a => (
                <div className="adapter" key={a.id}><i className="dot" />{ADAPTER_LABEL[a.id] ?? a.label}<span className="muted">{ADAPTER_HINT[a.id]}</span></div>
              ))}
            </div>
            <span className="tool-open">Mở thư viện game <I id="i-chev-right" size="sm" /></span>
          </button>
        ))}
        {soon.map(t => (
          <button key={t.id} className="tool-card locked" aria-disabled="true"
            onClick={() => toast("info", `${t.name} đang được phát triển`, `Hiện Nexa chỉ dịch được game ${ready.map(r => r.name).join(", ")}.`)}>
            <div className="top">
              <div className="tool-icon"><I id={ICON[t.id] ?? "i-box"} size="lg" /></div>
              <span className="badge"><I id="i-lock" />Sắp có</span>
            </div>
            <div><h3>{t.name}</h3><p>{t.description}</p></div>
          </button>
        ))}
      </div>
    </div>
  );
}
