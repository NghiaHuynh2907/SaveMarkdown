# SaveMarkdown
Save file md

## Đồng bộ tài liệu lên GitHub

Mỗi lần tạo / sửa / đổi tên / di chuyển / xóa / tải lên file, app tự `commit` + `push` thư mục `data/`
lên repo tài liệu (gom các thay đổi trong 5 giây thành 1 commit). Trong app có nút **Link GitHub**
(khi xem file) và mục **Copy link GitHub** (menu chuột phải file/thư mục) để gửi link cho team.

Cài đặt lần đầu:

1. Tạo repo **private, rỗng** trên GitHub (không tick README), vd. `NghiaHuynh2907/SaveMarkdown-docs`,
   rồi mời các member vào repo (Settings → Collaborators) để họ mở được link.
2. Khai báo repo trong `appsettings.json` → `Git:RemoteUrl`.
3. Cấp quyền push cho máy chạy app, chọn một trong hai:
   - Tạo fine-grained token (chỉ repo tài liệu, quyền *Contents: Read and write*) rồi lưu bằng
     `dotnet user-secrets set "Git:Token" "<token>"` hoặc biến môi trường `Git__Token`.
     **Không** ghi token vào `appsettings.json`.
   - Hoặc để trống `Token` và đăng nhập git một lần trên máy (Git Credential Manager).
4. Chạy app. Lần đầu app tự `git init` trong `data/`, commit file đang có và push lên.
   Nếu `data/` trống mà repo đã có tài liệu, app tự tải về.

Trạng thái đồng bộ (lần push gần nhất, lỗi nếu có): `GET /api/git/status`.
Tắt tính năng: `Git:Enabled = false`.
