# Deploy backend lên Supabase

Cloud mode giữ các chức năng admin, voter, màn hình chiếu, lịch sử, mẫu công
văn và xuất Excel. Edge Function xử lý API; Supabase Postgres lưu dữ liệu;
Realtime Broadcast báo có thay đổi. Socket.IO/Express vẫn hoạt động khi chạy
local.

**Giới hạn frontend:** Supabase Storage hiện phục vụ `.html` với MIME
`text/plain` và sandbox CSP. Vì vậy public bucket không thể làm website cho app
này, dù các object đã upload và backend hoạt động. GitHub Pages được cấu hình
bằng workflow trong `.github/workflows/deploy-pages.yml`.

## Chuẩn bị

1. Đảm bảo project `meeting-vote` đã hoàn tất khởi tạo trong Supabase.
2. Cài Node.js 18+ và chạy `npm install` trong repo.
3. Đăng nhập Supabase CLI bằng `npx supabase login`, rồi liên kết project:
   ```powershell
   npx supabase link --project-ref aqfugvogxelcfqwqbkut
   ```
   Access token chỉ nhập trực tiếp trong terminal.
4. Tạo hai file môi trường local:
   ```powershell
   Copy-Item .env.supabase.example .env.supabase
   Copy-Item .env.supabase-function.example .env.supabase-function
   ```
   Điền URL, publishable key, secret key và Session Pooler URI lấy từ
   Supabase **Connect**. Dùng URI có `sslmode=require`. Đặt `ADMIN_PASSWORD`
   mạnh, ngẫu nhiên. File thật bị Git ignore. Function dùng secret key Supabase
   tự inject làm khóa ký phiên.
   Trước khi dùng project, hãy reset database password trong Supabase và cập
   nhật URI mới vào các file env; password được generate trong phiên tạo project
   không nên dùng lại.

## Deploy database và function

Chạy migration trước, rồi nhập dữ liệu hiện có từ `data/data.json` và
`config/voters.json`:

```powershell
npx supabase db push
npm run supabase:import
```

Importer chỉ chép state khi bảng còn trống; voter PIN được lưu dưới dạng PBKDF2
hash có salt riêng. Nếu cần ghi đè state có sẵn, đặt `FORCE_IMPORT_STATE=true` trong
`.env.supabase` và chạy import có chủ đích.

Đẩy secrets riêng cho Edge Function rồi deploy:

```powershell
npx supabase secrets set --env-file .env.supabase-function --project-ref aqfugvogxelcfqwqbkut
npx supabase functions deploy meeting-vote --no-verify-jwt --project-ref aqfugvogxelcfqwqbkut
```

Function xác thực bằng token HMAC riêng của ứng dụng. Không bật quyền Data API
cho hai bảng; migration bật RLS và không cấp quyền cho `anon`/`authenticated`.

## Lưu static assets trong Supabase Storage

Có thể dùng uploader để lưu frontend/assets trong public bucket. Service key
chỉ được dùng từ script local, không được đưa vào frontend. URL object
`index.html` không phải URL website hoạt động; MIME/CSP hiện tại khiến trình
duyệt hiển thị source thay vì chạy trang.

Frontend được publish tại `https://caoduy1602.github.io/meeting-vote/` sau khi
workflow hoàn tất. Trong GitHub repository Settings > Pages, chọn **GitHub
Actions** làm Build and deployment source.

```powershell
npm run supabase:assets
```

Voter list mới được cập nhật từ `config/voters.json` bằng cách chạy lại
`npm run supabase:import`. Nếu project chưa healthy, đợi Supabase hoàn tất
provisioning trước khi chạy `db push` hoặc deploy function. Để đưa frontend lên
static host, cần cấu hình URL Edge Function và publishable key trong
`supabase-config.js`; không dùng secret key ở browser.