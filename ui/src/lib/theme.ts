import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";

const KEY = "nexa-theme";
const mql = window.matchMedia("(prefers-color-scheme: dark)");

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePref, animate: boolean) {
  const resolved = pref === "system" ? (mql.matches ? "dark" : "light") : pref;
  if (animate) {
    document.body.classList.add("theme-anim");
    setTimeout(() => document.body.classList.remove("theme-anim"), 320);
  }
  document.documentElement.dataset.theme = resolved;
}

/** Sáng / Tối / Theo Windows. Nhớ lựa chọn; "Theo Windows" tự đổi khi Windows đổi. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);
  const [systemDark, setSystemDark] = useState(mql.matches);

  useEffect(() => {
    apply(pref, false);
    window.nexa?.setTheme(pref);
    const onChange = () => {
      setSystemDark(mql.matches);
      if (readPref() === "system") apply("system", true);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (p: ThemePref) => {
    setPref(p);
    try { localStorage.setItem(KEY, p); } catch { /* bộ nhớ trình duyệt bị chặn → chỉ áp dụng lần này */ }
    apply(p, true);
    window.nexa?.setTheme(p);
  };

  return { pref, choose, systemDark };
}

const RM_KEY = "nexa-reduce-motion";
export function useReduceMotion() {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(RM_KEY) === "1"; } catch { return false; } });
  useEffect(() => { document.body.classList.toggle("reduce-motion", on); }, [on]);
  const set = (v: boolean) => {
    setOn(v);
    try { localStorage.setItem(RM_KEY, v ? "1" : ""); } catch { /* bỏ qua */ }
  };
  return [on, set] as const;
}
