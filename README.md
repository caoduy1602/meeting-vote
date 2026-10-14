# Biểu quyết cuộc họp — Supabase Cloud + Node.js local

Ứng dụng biểu quyết công văn cho cuộc họp. Cloud mode chạy API trên Supabase
Edge Functions, lưu dữ liệu trong Postgres và đồng bộ qua Realtime; local mode
dùng Express + Socket.IO.

## Tính năng

- **Quản trị viên**: đưa công văn ra biểu quyết, xem kết quả trực tiếp, kết
  thúc phiên để chốt kết quả, xuất báo cáo Excel (.xlsx).
- **Người biểu quyết**: chỉ những người có tên trong `config/voters.json` mới
  được vote (có thể thêm mã PIN 4 số để tránh giả mạo). Mỗi người chỉ tính 1
  phiếu cho mỗi công văn.
- **Màn hình kết quả**: chế độ chỉ xem, dùng để chiếu lên máy chiếu, không
  cần đăng nhập.
- Đồng bộ realtime qua **Supabase Broadcast** khi deploy cloud; chạy local vẫn
  dùng Socket.IO. Trạng thái mới được đọc lại từ server để tránh tin dữ liệu giả.
- Dữ liệu runtime được lưu vào file JSON trong một thư mục dữ liệu riêng khi chạy local; khi cấu hình Supabase PostgreSQL, trạng thái được lưu trong database.

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

## Triển khai với Supabase

Cloud backend dùng Supabase Edge Functions, Postgres và Realtime; Express/
Socket.IO vẫn được giữ để chạy local. Frontend được publish qua GitHub Pages
vì Supabase Storage sandbox HTML. Site dự kiến tại
https://caoduy1602.github.io/meeting-vote/ sau khi GitHub Actions hoàn tất.
Xem [DEPLOY_SUPABASE.md](DEPLOY_SUPABASE.md) để biết cấu hình.

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
├── server.js              # Express + Socket.IO cho chạy local
├── package.json
├── .env.example            # mẫu cấu hình, copy thành .env
├── config/
│   └── voters.example.json # mẫu danh sách người biểu quyết, copy thành voters.json
├── data/                   # tự tạo data.json khi chạy lần đầu
├── scripts/                # nhập state/voter và upload frontend Supabase
├── supabase/
│   ├── config.toml
│   ├── functions/           # Edge Function API
│   └── migrations/          # schema và quyền truy cập
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
