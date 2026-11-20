/**
 * Lớp app/: các "việc" của tool (mở game, ước tính, dịch, export, Font Doctor...).
 * Dùng chung cho CLI và Electron. Không in ra màn hình, không đọc bàn phím:
 * báo qua sự kiện (ctx.emit), hỏi qua ctx.prompt.
 */
export * from "./events";
export * from "./context";
export * from "./session";
export * from "./engines";
export * from "./plan";
export * from "./translate";
export * from "./export";
export * from "./font";
export * from "./extract";
export * from "./clean";
export * from "./library";
export * from "./files";
export { TOOLS, getTool, guessEngine, type ToolInfo } from "../formats/tools";
export * from "./review";
export * from "./names";
