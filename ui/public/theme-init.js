// Đặt sáng/tối trước khi giao diện vẽ, tránh nháy nền trắng khi mở app ở chế độ tối.
try {
  var p = localStorage.getItem("nexa-theme");
  var dark = p === "dark" || (p !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
} catch (e) { /* bộ nhớ trình duyệt bị chặn → dùng mặc định */ }
