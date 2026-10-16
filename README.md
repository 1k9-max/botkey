# Nguc AFK Bot: Hướng dẫn cài đặt và vận hành

Dashboard và API chạy trên Vercel, dữ liệu lưu trong Supabase, còn bot Mineflayer chạy trên một máy/host luôn bật. Vercel Functions không giữ kết nối TCP Minecraft chạy liên tục.

## Thành phần

- `index.html`: dashboard lấy key free và giao diện quản trị.
- `api/`: Vercel Functions cho cấu hình, trạng thái, log, license và bot agent.
- `supabase/schema.sql`: schema khởi tạo database.
- `nguc3.js`: source bot để phát triển.
- `bot.js`: artifact bundle/obfuscate để chạy hoặc phân phối; tạo lại bằng script build.
- `lib/`: helper API/bot; `scripts/build-bot.js`: build artifact.
- `test/`: test tự động, không cần credentials Supabase.
- `.env.example`: tên biến môi trường mẫu, không chứa secret thật.

ZIP không chứa `.git/`, `node_modules/`, `.env` thật hoặc `config.json`; chúng chứa lịch sử, dependency đã cài hoặc thông tin cá nhân.

## Cài đặt Supabase

1. Tạo project Supabase Free.
2. Mở SQL Editor, chạy toàn bộ nội dung [`supabase/schema.sql`](supabase/schema.sql).
3. Lấy Project URL và `service_role` key trong Project Settings > API. Không đưa `service_role` key vào trình duyệt hoặc commit vào Git.
4. Có thể chạy lại file schema sau này; các bảng/cột hiện có được giữ lại.

## Deploy dashboard lên Vercel

1. Đẩy repository lên GitHub và import repo từ **Vercel > New Project > Import Git Repository**.
2. Chọn Framework Preset **Other**, Root Directory là thư mục dự án; để Build Command và Output Directory trống.
3. Thêm các Environment Variables sau trong Project Settings:

| Variable | Giá trị |
| --- | --- |
| `SUPABASE_URL` | Project URL của Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret `service_role` key của Supabase |
| `ADMIN_TOKEN` | Token bí mật dùng để đăng nhập dashboard |
| `BOT_TOKEN` | Token bí mật riêng cho tiến trình bot |
| `LINK4M_API_KEY` | API key Link4m, chỉ lưu trong Vercel Environment Variables |
| `PUBLIC_APP_URL` | URL HTTPS production của dashboard, ví dụ `https://your-project.vercel.app` |
| `VIP_CONTACT_URL` | Link HTTPS Discord để khách liên hệ mua VIP |

Tạo `ADMIN_TOKEN` và `BOT_TOKEN` khác nhau, đủ dài và ngẫu nhiên. Ví dụ: `openssl rand -hex 32`. Đặt `PUBLIC_APP_URL` là domain HTTPS production chính xác. Redeploy sau khi thêm biến môi trường. Mở URL Vercel và đăng nhập bằng `ADMIN_TOKEN`.

`LINK4M_API_KEY` chỉ được dùng trong Vercel Function, không đi xuống browser. Nếu chưa có key Link4m hoặc dịch vụ rút gọn lỗi, API vẫn trả link trực tiếp kèm cảnh báo. `VIP_CONTACT_URL` phải là link HTTPS thuộc `discord.gg` hoặc `discord.com`.

## Chạy bot trên máy luôn bật

Node.js 18 trở lên được yêu cầu. Địa chỉ Minecraft được cấu hình bằng `MC_HOST`, `MC_PORT`, `MC_VERSION` hoặc trong `config.json`; địa chỉ không còn hard-code trong source.

```sh
npm ci
MC_HOST=your-minecraft-host \
MC_PORT=19000 \
MC_VERSION=1.21.4 \
BOT_API_URL=https://your-project.vercel.app \
BOT_TOKEN=your-bot-token \
npm run start:protected
```

`BOT_API_URL` và `BOT_TOKEN` phải cùng được đặt; bot dùng `BOT_API_URL` làm license server. Username/password/license key được nhập trong dashboard Vercel. Địa chỉ Minecraft được cấu hình trên worker bằng `MC_HOST`, `MC_PORT`, `MC_VERSION`; file `config.json` sẵn có có thể ghi đè host/port/version.

`npm run start:protected` tạo file `bot.js` bằng cách bundle helper và obfuscate source rồi chạy file đó. Để chỉ tạo artifact: `npm run build:bot`; sau đó chạy `node bot.js`. Giữ tiến trình chạy liên tục bằng dịch vụ quản lý process của host. Khi chỉ phân phối artifact, máy chạy cần Node.js 18+ và runtime dependencies; `npm ci --omit=dev` cài runtime dependencies nếu `bot.js` đã được build sẵn.

Obfuscation chỉ làm source khó đọc hơn, không phải mã hóa an toàn: người có thể chạy bot vẫn có thể phân tích file hoặc quan sát các kết nối mạng. Không nhúng secret vào bot; giữ token trong environment variables. Địa chỉ server cũng có thể bị quan sát lúc kết nối. Nên để repository chứa source ở chế độ private nếu không muốn công khai mã nguồn.

Để chạy local, để trống cả `BOT_API_URL` và `BOT_TOKEN`, đặt `LICENSE_API_URL` tới URL production Vercel, rồi chạy `npm start` khi phát triển hoặc `npm run start:protected` để build/chạy `bot.js`. Mở `http://localhost:3000`, nhập tên/mật khẩu/key rồi **Lưu**. Key mới được xác minh trước khi ghi vào `config.json`; key sai không ghi đè key hợp lệ hiện có.

## License keys

Trang public có nút **Lấy key free và link**. Mỗi IP tạo tối đa một key trong một cửa sổ 12 giờ UTC; key free hết hạn 12 giờ tính từ lúc tạo. Link4m rút gọn URL dashboard có query `key`; nếu tạo key qua link, trang hiển thị key để copy.

Admin đăng nhập bằng `ADMIN_TOKEN`, mở tab **License**, chọn thời hạn giờ từ 1 đến 87600 rồi tạo key VIP. Hạn VIP cũng bắt đầu từ lúc tạo. Danh sách admin hiển thị loại, trạng thái, thời hạn và IP đã gắn; nút **Thu hồi** vô hiệu key. Nút mua VIP mở `VIP_CONTACT_URL`.

Key có 30 ký tự hex ngẫu nhiên. Database lưu key, thời điểm tạo/hết hạn, IP tạo và IP bind. IP không bind khi người dùng mở link; lần bot đầu tiên xác minh thành công sẽ gắn key với IP public đầu ra của máy chạy bot. Key đã bind không dùng được trên IP khác. Bot kiểm tra lại mỗi phút; key hết hạn/bị thu hồi thì bot dừng và không tự reconnect.

Nếu DevTools bị phát hiện trong panel local, app xóa key khỏi `config.json` trên máy đó và dừng bot. Đây không thu hồi key trong database; admin có thể thu hồi key từ tab License. Không dùng dấu hiệu DevTools để thu hồi server-side vì trình duyệt có thể giả mạo tín hiệu đó.

## Web DevTools và bảo mật

Nếu panel local phát hiện DevTools, app xóa key khỏi `config.json` trên máy đó và dừng bot. Thao tác này không thu hồi key trong database; admin có thể thu hồi thủ công từ tab License. Không thu hồi server-side chỉ dựa trên tín hiệu DevTools vì client có thể giả mạo tín hiệu đó.

Obfuscation chỉ làm source khó đọc hơn, không phải mã hóa an toàn. Người có thể chạy chương trình vẫn có thể phân tích artifact hoặc quan sát địa chỉ kết nối. Không nhúng `ADMIN_TOKEN`, `BOT_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` hoặc `LINK4M_API_KEY` vào `bot.js`. Giữ secret trong environment variables và để repository private nếu không muốn công khai source.

## Kiểm tra

Chạy trước khi push lên GitHub:

```sh
npm run check
npm test
npm audit
```

Test không cần kết nối Supabase thật. `npm run build:bot` kiểm tra thêm pipeline tạo artifact.

## Khắc phục sự cố

| Triệu chứng | Việc cần kiểm tra |
| --- | --- |
| Dashboard báo lỗi database | Đã chạy `supabase/schema.sql` chưa? Kiểm tra `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY`, rồi redeploy. |
| Không tạo được link rút gọn | Kiểm tra `LINK4M_API_KEY` và `PUBLIC_APP_URL` HTTPS; nếu Link4m lỗi, dùng link trực tiếp trong cảnh báo. |
| Không vào được dashboard admin | Dùng giá trị `ADMIN_TOKEN` trên Vercel, không phải `BOT_TOKEN`. |
| Bot báo thiếu token | Cloud mode cần cả `BOT_API_URL` lẫn `BOT_TOKEN`; local mode để trống cả hai và đặt `LICENSE_API_URL`. |
| Bot chưa có license/đang offline | Lưu key hợp lệ trong dashboard/local panel; kiểm tra key chưa hết hạn/thu hồi và cùng IP public với worker đã bind. |
| Bot không tới Minecraft | Kiểm tra `MC_HOST`, `MC_PORT`, `MC_VERSION`, firewall và log kết nối. |
| `start:protected` báo thiếu module build | Chạy `npm ci` đầy đủ, không dùng `--omit=dev` khi đang build. |

## Giới hạn gói miễn phí

Supabase Free và Vercel Hobby có giới hạn dung lượng, request và chính sách vận hành riêng; xem quota hiện hành của nhà cung cấp trước khi dùng lâu dài. Database dùng RLS và chỉ API server-side truy cập bằng service key; dashboard và bot xác thực bằng hai token tách biệt.