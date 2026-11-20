import { join } from "node:path";
import { updateGlossaryFile, loadGlossaryFile, type GlossaryFile } from "../core/glossary";
import { detectNameLang, suggestNames, type NameLang, type NameSuggestion } from "../core/names";
import { googleReading } from "../core/providers/google";
import type { GameSession } from "./session";

/**
 * Đổi tên nhân vật (Actors.json / DB_Actor.csv) sang chữ đọc được:
 * Latin giữ nguyên, Nhật → Romaji, Trung → Hán Việt. Người dùng duyệt rồi mới lưu vào glossary.json ("actors").
 * Tên đã lưu được dùng ở: Actors.json (menu, trạng thái, \N[n]), tên người nói, và trong câu thoại.
 */

export interface ActorNameRow {
  id: number;
  /** Tên gốc trong game. */
  source: string;
  /** Tên đã duyệt (rỗng = giữ tên gốc). */
  current: string;
}

export interface ActorNamesView {
  /** Ngôn ngữ nhận diện từ chữ của cả game. */
  detected: NameLang;
  /** File chứa tên nhân vật (để hiện cho người dùng). */
  file: string;
  actors: ActorNameRow[];
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function actorSource(session: GameSession) {
  const fmt = session.fmt.actorNames ? session.fmt : session.rpgmData;
  if (!fmt?.actorNames) return null;
  return { fmt, dir: fmt === session.fmt ? session.sourceDir() : session.sourceDirOf(fmt) };
}

const glossaryPath = (session: GameSession) => join(session.paths.projDir, "glossary.json");

export function actorNamesView(session: GameSession): ActorNamesView {
  const src = actorSource(session);
  const actors = src?.fmt.actorNames?.(src.dir) ?? [];
  const approved = loadGlossaryFile(glossaryPath(session)).actors;
  // Ngôn ngữ: theo chữ của cả game (thoại, vật phẩm...) – không theo từng tên
  const texts = session.loadEntries(session.fmt, session.sourceDir()).flatMap(f => f.entries.map(e => e.source));
  return {
    detected: detectNameLang(texts),
    file: src?.fmt.id === "rpgm-kns-csv" ? "csv/DB_Actor.csv" : "data/Actors.json",
    actors: actors.map(a => ({ id: a.id, source: a.name, current: approved[a.name] ?? "" })),
  };
}

/**
 * Gợi ý tên. Tên tiếng Nhật có kanji cần cách đọc từ Google (miễn phí, gọi từng tên, nghỉ 300 ms).
 * Tên trùng chỉ hỏi 1 lần.
 */
export async function suggestActorNames(names: string[], lang: NameLang): Promise<NameSuggestion[]> {
  const uniq = [...new Set(names.map(n => n.trim()).filter(Boolean))];
  let first = true;
  const reading = async (s: string) => {
    if (!first) await sleep(300);
    first = false;
    return googleReading(s, "ja");
  };
  return suggestNames(uniq, lang, reading);
}

/**
 * Lưu tên đã duyệt vào glossary.json. Tên rỗng hoặc giống tên gốc = giữ nguyên (xóa khỏi danh sách).
 * Ghi đè TOÀN BỘ danh sách actors bằng `names` (bảng duyệt luôn gửi đủ).
 */
export function saveActorNames(session: GameSession, names: Record<string, string>): GlossaryFile {
  const actors: Record<string, string> = {};
  for (const [src, dst] of Object.entries(names)) {
    const s = src.trim(), d = dst.replace(/\s+/g, " ").trim();
    if (s && d && d !== s) actors[s] = d;
  }
  return updateGlossaryFile(glossaryPath(session), { actors });
}

export interface UserGlossaryInput {
  keep: string[];
  terms: Record<string, string>;
  translate: string[];
}

/** Lưu phần glossary người dùng sửa trong app (giữ nguyên mục actors và các mục khác trong file). */
export function saveUserGlossary(session: GameSession, g: UserGlossaryInput): GlossaryFile {
  const list = (xs: string[]) => [...new Set(xs.map(x => x.trim()).filter(Boolean))];
  const terms: Record<string, string> = {};
  for (const [k, v] of Object.entries(g.terms)) {
    const s = k.trim(), d = v.trim();
    if (s && d) terms[s] = d;
  }
  const keep = list(g.keep).filter(k => !(k in terms));
  return updateGlossaryFile(glossaryPath(session), { keep, terms, translate: list(g.translate) });
}
