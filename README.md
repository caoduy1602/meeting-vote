# Biểu quyết cuộc họp — Backend Node.js + Socket.IO

Ứng dụng biểu quyết công văn cho cuộc họp, đồng bộ tức thời (WebSocket) giữa
màn hình quản trị, người biểu quyết, và màn hình chiếu kết quả.

## Tính năng

- **Quản trị viên**: đưa công văn ra biểu quyết, xem kết quả trực tiếp, kết
  thúc phiên để chốt kết quả, xuất báo cáo Excel (.xlsx).
- **Người biểu quyết**: chỉ những người có tên trong `config/voters.json` mới
  được vote (có thể thêm mã PIN 4 số để tránh giả mạo). Mỗi người chỉ tính 1
  phiếu cho mỗi công văn.
- **Màn hình kết quả**: chế độ chỉ xem, dùng để chiếu lên máy chiếu, không
  cần đăng nhập.
- Đồng bộ qua **WebSocket (Socket.IO)** — cập nhật gần như tức thời, không
  cần bấm F5.
- Dữ liệu runtime được lưu vào file JSON trong một thư mục dữ liệu riêng, mặc định là `data/data.json` khi chạy local. Trên Render, ứng dụng sẽ sử dụng biến môi trường `DATA_DIR` để trỏ tới thư mục Persistent Disk.

## Cài đặt (chạy thử trên máy của bạn)

```bash
npm install
cp .env.example .env
cp config/voters.example.json config/voters.json
```

Mở `.env` và đổi:
- `ADMIN_PASSWORD` — mật khẩu đăng nhập quản trị viên
- `SESSION_SECRET` — chuỗi bí mật ngẫu nhiên, dài (dùng để ký token đăng nhập)

Mở `config/voters.json` và nhập danh sách người được phép biểu quyết:

```json
[
  { "id": "v1", "name": "Nguyễn Văn A", "pin": "1234" },
  { "id": "v2", "name": "Trần Thị B", "pin": "2345" }
]
```

`pin` là tuỳ chọn — nếu bỏ trống hoặc xoá field `pin`, người đó chỉ cần chọn
tên là vào được (phù hợp họp nội bộ ít rủi ro).

Chạy server:

```bash
npm start
```

Mở trình duyệt tại `http://localhost:3000`.

## Triển khai thật (deploy)

### Cách 1 — Render Web Service (đảm bảo JSON runtime bền)

1. Đẩy code này lên một repo GitHub.
2. Trên Render.com: tạo một **Web Service** mới và kết nối repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Thêm biến môi trường:
   - `ADMIN_PASSWORD` — mật khẩu admin
   - `SESSION_SECRET` — key cho JWT
   - `DATA_DIR=/opt/render/project/src/data`
5. Tạo Persistent Disk trên Render và mount nó vào `Mount Path: /opt/render/project/src/data`.
   - Ứng dụng sẽ tự động dùng thư mục này nếu nó tồn tại.
   
6. (Tùy chọn, được cấu hình sẵn trong `render.yaml`) Bạn có thể provision một
  PostgreSQL managed database trực tiếp từ `render.yaml`. Khi `DATABASE_URL`
  được đặt, ứng dụng sẽ tự động chuyển sang lưu trạng thái vào database và
  (nếu DB rỗng) sẽ import dữ liệu từ `data/data.json` nếu file đó tồn tại.
  - Nếu bạn deploy qua Render bằng file `render.yaml`, một database tên
    `meeting-vote-db` sẽ được tạo (kế hoạch `starter`). `DATABASE_URL` sẽ
    được thiết lập từ connection string của database này.
6. Nếu muốn dùng danh sách người biểu quyết thay đổi mà không deploy lại, có thể đặt `config/voters.json` trong repo hoặc dùng `VOTERS_FILE` để trỏ đến file JSON riêng trên disk.

**Lưu ý về ổ đĩa:** `DATA_DIR` phải trỏ tới thư mục trên Render Persistent Disk. Dữ liệu JSON runtime sẽ nằm ngoài source code và không bị mất khi redeploy, restart, hoặc crash.

### Cách 2 — VPS riêng (kiểm soát toàn bộ, dùng domain nội bộ cơ quan)

1. Cài Node.js 18+ trên VPS.
2. Copy toàn bộ thư mục dự án lên VPS (`scp` hoặc `git clone`).
3. Làm các bước cài đặt như trên (`npm install`, tạo `.env`, `voters.json`).
4. Chạy nền bằng PM2 để tự khởi động lại khi crash hoặc reboot server:
   ```bash
   npm install -g pm2
   pm2 start server.js --name meeting-vote
   pm2 save
   pm2 startup
   ```
5. Đặt Nginx làm reverse proxy để dùng domain nội bộ + HTTPS (khuyến nghị
   dùng chứng chỉ nội bộ hoặc Let's Encrypt nếu có domain public), ví dụ
   cấu hình Nginx tối thiểu:
   ```nginx
   server {
     listen 80;
     server_name hop.congty.local;
     location / {
       proxy_pass http://localhost:3000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
     }
   }
   ```
   Phần `Upgrade`/`Connection` bắt buộc phải có để WebSocket hoạt động qua
   Nginx.

## Bảo mật cần lưu ý trước khi dùng thật

- Đổi `ADMIN_PASSWORD` và `SESSION_SECRET` mặc định — không dùng giá trị mẫu.
- Chỉ chia sẻ link "màn hình chiếu" công khai; link chính vẫn nên qua HTTPS
  nội bộ nếu họp có nội dung nhạy cảm.
- Cân nhắc thêm mã PIN cho từng người trong `voters.json` nếu muốn chống giả
  mạo danh tính khi biểu quyết.
- File `data/data.json` chứa toàn bộ lịch sử biểu quyết — sao lưu định kỳ
  nếu cần giữ hồ sơ lâu dài.

## Cấu trúc thư mục

```
meeting-vote/
├── server.js              # Express + Socket.IO + API xuất Excel
├── package.json
├── .env.example            # mẫu cấu hình, copy thành .env
├── config/
│   └── voters.example.json # mẫu danh sách người biểu quyết, copy thành voters.json
├── data/                   # tự tạo data.json khi chạy lần đầu
└── public/                 # frontend (HTML/CSS/JS thuần, không cần build)
    ├── index.html
    ├── styles.css
    └── app.js
```

## Mở rộng thêm (gợi ý)

- Xuất báo cáo Word (.docx) thay vì/thêm cạnh Excel.
- Thêm đăng nhập bằng tài khoản công ty (SSO/LDAP) thay vì danh sách tĩnh.
- Chuyển `data/data.json` sang SQLite hoặc Postgres nếu số lượng công văn
  và người dùng lớn.
- Thêm giới hạn thời gian biểu quyết (đếm ngược tự động đóng phiên).

## Tự động sao lưu dữ liệu bằng GitHub (miễn phí)

Ứng dụng có cơ chế sao lưu `data/data.json` lên một branch riêng (`data-backups`) trong cùng repo trên GitHub. Khi ứng dụng khởi động, nếu không tìm thấy `data/data.json` cục bộ nó sẽ thử tải về từ branch này. Khi lưu, app sẽ upload (non-blocking) lên GitHub nếu biến môi trường cấu hình sẵn.

Biến môi trường cần thêm trên Render (hoặc môi trường production):
- `GITHUB_PERSIST_REPO` = owner/repo (ví dụ `caoduy1602/meeting-vote`)
- `GITHUB_PERSIST_BRANCH` = `data-backups`
- `GITHUB_DATA_PATH` = `data/data.json`
- `GITHUB_TOKEN` = GitHub Personal Access Token (scope: `repo` or `public_repo`)

Nếu bạn muốn script tự đặt các biến này trên Render (qua API), dùng file `scripts/set_render_env.ps1` từ repository — chạy trên máy Windows với PowerShell:

```powershell
# ví dụ
# $env:RENDER_API_KEY = '<your_render_api_key>'
# .\scripts\set_render_env.ps1 -ServiceId 'srv-xxxx' -Repo 'owner/repo' -GithubToken '<your_github_pat>'
```

Hoặc, thêm thủ công các biến môi trường trên Render Dashboard: Service → Environment → Add Variable → Save → Redeploy.

Sau khi hoàn tất, bạn có thể trigger một backup thủ công (đợi tới khi deploy xong) bằng cách gửi POST tới endpoint admin:

```
POST /api/admin/backup
Authorization: Bearer <admin-token>
```

Cuối cùng, có GitHub Action mẫu `.github/workflows/verify-backup.yml` để kiểm tra branch `data-backups` tồn tại và (tuỳ chọn) trigger redeploy trên Render nếu bạn lưu `RENDER_API_KEY` và `RENDER_SERVICE_ID` trong `Secrets` của repo.

Nhớ: sau khi xác thực xong, xoá hoặc rotate token bạn đã tạo để giữ an toàn.
