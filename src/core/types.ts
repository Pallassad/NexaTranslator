export type Kind =
  | "dialogue"     // 401
  | "choice"       // 102
  | "scroll"       // 405
  | "mapName"      // displayName
  | "name"         // name của Items/Skills/...
  | "description"
  | "message"      // message1–4 của Skills/States
  | "term"         // System.json
  | "speaker";     // tên người nói (lệnh 101, MZ) – chỉ đổi khi glossary có thuật ngữ cho tên đó

export interface Entry {
  file: string;                  // "Map001.json"
  path: (string | number)[];     // vị trí chính xác trong JSON
  kind: Kind;
  source: string;                // text gốc
  target?: string;               // bản dịch (chưa có = chưa dịch)
  /**
   * Khối thoại (định dạng không phải RPGM data, vd 1 ô CSV): các dòng "dialogue" cùng block,
   * liên tiếp nhau (phần tử cuối của path) được gộp thành 1 câu để dịch.
   */
  block?: string;
  /**
   * Khối giữ ĐÚNG số dòng gốc: bản dịch được chia đều vào các dòng có sẵn, không thêm dòng
   * (vd mô tả kỹ năng trong khung cố định, câu thoại trong nhật ký trận đánh không xuống dòng được).
   */
  fixedLines?: boolean;
  /**
   * Bản dịch ngắn hơn (ít dòng hơn bản gốc) → chia đều vào đủ số dòng thay vì để dòng trống
   * (mảng dòng được game nối bằng "\n" – dòng trống sẽ thành dòng trắng trong khung thoại).
   */
  fillLines?: boolean;
}
