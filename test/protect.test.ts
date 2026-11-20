import { describe, expect, test } from "vitest";
import { splitAffix, protect, restore } from "../src/core/protect";
import { cleanTranslation, wrapText } from "../src/core/postprocess";

describe("splitAffix", () => {
  test("tách mã căn giữa ở đầu dòng", () => {
    expect(splitAffix("<center>After a heavy pause,")).toEqual({ prefix: "<center>", core: "After a heavy pause,", suffix: "" });
  });
  test("tách dấu cách căn lề + mã chờ ở cuối", () => {
    expect(splitAffix("     *Skip the intro?\\!")).toEqual({ prefix: "     ", core: "*Skip the intro?", suffix: "\\!" });
  });
  test("giữ dấu cách đầu của message kỹ năng", () => {
    expect(splitAffix(" casts %1!")).toEqual({ prefix: " ", core: "casts %1!", suffix: "" });
  });
});

describe("protect / restore", () => {
  test("bảo vệ và khôi phục đúng", () => {
    const p = protect("Hello \\C[2]Alice\\C[0], you got %1 \\G!");
    expect(p.text).toBe("Hello {0}Alice{1}, you got {2} {3}!");
    const r = restore("Xin chào {0}Alice{1}, bạn nhận {2} {3}!", p.tokens);
    expect(r).toEqual({ ok: true, text: "Xin chào \\C[2]Alice\\C[0], bạn nhận %1 \\G!" });
  });
  test("chấp nhận placeholder bị Google thêm dấu cách", () => {
    const p = protect("Hi \\N[1]!");
    expect(restore("Chào { 0 }!", p.tokens)).toEqual({ ok: true, text: "Chào \\N[1]!" });
  });
  test("báo lỗi khi mất placeholder", () => {
    const p = protect("Hi \\N[1]!");
    expect(restore("Chào bạn!", p.tokens).ok).toBe(false);
  });
});

describe("postprocess", () => {
  test("NFC + dấu câu CJK", () => {
    const nfd = "Tiếng Việt「hay」";
    expect(cleanTranslation(nfd)).toBe("Tiếng Việt\"hay\"");
  });
  test("ngắt dòng tại dấu cách", () => {
    expect(wrapText("Ted là một du học sinh đến từ Hoa Kỳ", 15)).toEqual(["Ted là một du", "học sinh đến từ", "Hoa Kỳ"]);
  });
});
