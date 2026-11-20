import { useEffect } from "react";
import { Toasts } from "./components/common";
import { IconSprite } from "./components/Icon";
import { TitleBar } from "./components/TitleBar";
import { Dialogs } from "./dialogs/Dialogs";
import { onPrompt } from "./lib/actions";
import { onAppEvent } from "./lib/events";
import { errMsg } from "./lib/format";
import { setState, toast, useApp } from "./lib/store";
import { useTheme } from "./lib/theme";
import { FontScreen } from "./screens/Font";
import { GlossaryScreen } from "./screens/Glossary";
import { LibraryScreen } from "./screens/Library";
import { SettingsScreen } from "./screens/Settings";
import { ToolsScreen } from "./screens/Tools";
import { TranslateScreen } from "./screens/Translate";

export function App() {
  const s = useApp();
  const theme = useTheme();

  // Nối với tiến trình chính: sự kiện, câu hỏi, xác nhận thoát
  useEffect(() => {
    const offs = [
      window.nexa.onEvent(onAppEvent),
      window.nexa.onPrompt(onPrompt),
      window.nexa.onConfirmQuit(() => setState({ dialog: { kind: "quit" } })),
    ];
    window.nexa.tools()
      .then(tools => setState({ tools, tool: tools.find(t => t.status === "ready") ?? null }))
      .catch(e => toast("error", "Không khởi động được", errMsg(e)));
    // Giới hạn chi phí mặc định (Cài đặt) → ô "Giới hạn chi phí" ở tab Dịch
    window.nexa.settings().then(c => setState({ maxCost: c.maxCost ? c.maxCost.toFixed(2) : "" })).catch(() => {});
    return () => offs.forEach(off => off());
  }, []);

  useEffect(() => { document.body.classList.toggle("at-tools", s.screen === "tools"); }, [s.screen]);

  const needTool = s.screen !== "tools" && s.screen !== "settings" && !s.tool;
  const screen = needTool ? "tools" : s.screen;

  return (
    <>
      <IconSprite />
      <TitleBar theme={theme} />
      <main className="app">
        <section className="screen active" key={screen} aria-label={screen}>
          {screen === "tools" && <ToolsScreen />}
          {screen === "library" && <LibraryScreen />}
          {screen === "translate" && <TranslateScreen />}
          {screen === "glossary" && <GlossaryScreen />}
          {screen === "font" && <FontScreen />}
          {screen === "settings" && <SettingsScreen theme={theme} />}
        </section>
      </main>
      <Dialogs />
      <Toasts />
    </>
  );
}
