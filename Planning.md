# 🚀 BẢN KẾ HOẠCH THỰC THI DỰ ÁN: BREWLITE

## 1. TỔNG QUAN DỰ ÁN & MỤC TIÊU (PROJECT VISION)
- **Product Vision & Core Objectives:** 
  - Ứng dụng BrewLite giúp khách hàng đặt và thanh toán đồ uống không dùng tiền mặt chỉ trong vài chạm[cite: 4].
  - Mục tiêu cốt lõi là giảm thời gian xếp hàng và nhận đơn nhanh tại quầy[cite: 4].
- **Stakeholders & Roles:**
  - Trong vòng lặp Scrum, các vai trò chính bao gồm Product Owner (PO), Scrum Master (SM) và Development Team[cite: 3].
  - Các bên liên quan khác bao gồm Khách hàng, Nhân viên quầy/Barista, Quản lý cửa hàng, Giảng viên nghiệm thu và Đơn vị thanh toán[cite: 4].
- **Core Business Workflow (End-to-End Happy Path):**
  - Mở app và Xem menu[cite: 5].
  - Chọn sản phẩm (size, topping) và Thêm vào giỏ hàng[cite: 5].
  - Xem giỏ hàng & tổng tiền (có thể quay lại thêm sản phẩm khác)[cite: 5].
  - Đăng nhập (nếu chưa có tài khoản)[cite: 5].
  - Thanh toán không tiền mặt (nếu lỗi sẽ báo hủy/thanh toán lỗi, nếu thành công sẽ tiếp tục)[cite: 5].
  - Xác nhận đơn (nhận mã đơn) và Nhận đồ uống[cite: 5].

## 2. KIẾN TRÚC HỆ THỐNG & CÔNG NGHỆ (ARCHITECTURE & TECH STACK)
- **System Architecture Diagram / Flow:**
  - Frontend (Next.js) chịu trách nhiệm render và gửi request REST/JSON tới Backend[cite: 6].
  - Backend (NestJS) tiếp nhận REST API, xử lý logic và giao tiếp với CSDL PostgreSQL thông qua ORM[cite: 6].
  - Backend sẽ gọi cổng thanh toán giả lập (Mock Payment Gateway) để xử lý thanh toán[cite: 6].
- **Detailed Tech Stack & Libraries:**
  - **Frontend:** Next.js (React, TypeScript), TailwindCSS, React Query / Zustand để quản lý state giỏ hàng[cite: 6].
  - **Backend:** NestJS (TypeScript), REST, class-validator, JWT (Passport)[cite: 6].
  - **Database:** PostgreSQL kết hợp Prisma (hoặc TypeORM)[cite: 6].
  - **Payment:** Mock Payment Service mô phỏng Momo/VNPay/Stripe[cite: 6].
  - **DevOps:** Docker Compose, Git, README để bàn giao[cite: 6].
- **Data Entities Schema & Minimum REST API Endpoints:**
  - **Thực thể dữ liệu tối thiểu:** Product, User, Order, OrderItem, Payment[cite: 7].
  - **REST API Endpoints:** 
    - `GET /products` (Danh sách sản phẩm), `GET /products/:id` (Chi tiết)[cite: 7].
    - `POST /auth/register` (Đăng ký), `POST /auth/login` (Đăng nhập)[cite: 7].
    - `POST /orders` (Tạo đơn), `POST /payments` (Thanh toán), `GET /orders/me` (Lịch sử đơn)[cite: 7].

## 3. QUY TRÌNH THIẾT KẾ UI/UX TRÊN GOOGLE STITCH
- **Workflow to translate document wireframes:**
  - Dựa vào 5 bản wireframe MVP có sẵn trong tài liệu để thiết kế bố cục UI chi tiết trên Google Stitch bằng Next.js và TailwindCSS[cite: 6].
- **List of core screens and key UI components:**
  - **(1) Menu:** Hiển thị lưới danh sách đồ uống kèm hình, tên và giá[cite: 6].
  - **(2) Chi tiết:** Component chọn size (S, M, L), chọn topping và nút thêm vào giỏ[cite: 6].
  - **(3) Giỏ hàng:** Liệt kê các món đã chọn, số lượng và tổng tiền[cite: 6].
  - **(4) Thanh toán:** Form chọn phương thức thanh toán (Ví điện tử hoặc Thẻ ngân hàng)[cite: 6].
  - **(5) Xác nhận:** Màn hình báo đặt hàng thành công, hiển thị mã đơn hàng (#1042) và trạng thái PAID[cite: 6].

## 4. PRODUCT BACKLOG & PHÂN BỔ SPRINT (AGILE SCRUM ROADMAP)
- **Complete Product Backlog Table:**

| Task ID | Story / Task | Key Requirements | Points |
|---|---|---|---|
| 1 | Khởi tạo dự án và cấu trúc | Tạo monorepo (Next.js + NestJS), chạy "Hello", README, Git, .env[cite: 6, 7] | 1 |
| 2 | API danh sách sản phẩm | NestJS `GET /products` trả về JSON menu từ dữ liệu mẫu/CSDL[cite: 6, 7] | 1 |
| 3 | Trang Menu (Frontend) | Next.js gọi API, render lưới sản phẩm, xử lý loading/empty state[cite: 6, 7] | 1 |
| 4 | Chi tiết và tùy chọn sản phẩm | Chọn size, topping; tính giá theo tùy chọn[cite: 6, 7] | 1 |
| 5 | Giỏ hàng (Cart) | Thêm/sửa/xóa bằng Zustand; tự tính tổng tiền; hiển thị badge số lượng[cite: 6, 7] | 1 |
| 6 | API tạo đơn hàng | NestJS `POST /orders` nhận giỏ hàng, validate, lưu trạng thái PENDING[cite: 6, 7] | 1 |
| 7 | Đăng ký / Đăng nhập (JWT) | Băm mật khẩu (bcrypt), phát JWT, bảo vệ route đặt đơn bằng guard[cite: 6, 7] | 1 |
| 8 | Thanh toán không tiền mặt | Tích hợp mock payment, chuyển trạng thái PAID (thành công) hoặc PAYMENT_FAILED (lỗi)[cite: 6, 7] | 1 |
| 9 | Xác nhận, lịch sử đơn & bàn giao | Màn hình xác nhận, lịch sử `GET /orders/me`, Docker-compose chạy 3 service[cite: 6, 7] | 1 |
| 10 | Nghiệp vụ backend nâng cao | State Machine, Payment Idempotency, Concurrency Control, Loyalty Points[cite: 6, 7] | 1 |

- **Sprint Breakdown:**
  - **Sprint 1 (Nền tảng & hiển thị menu):** Triển khai Task 1, 2, 3, 4[cite: 3].
  - **Sprint 2 (Giỏ hàng, đặt đơn & đăng nhập):** Triển khai Task 5, 6, 7[cite: 3].
  - **Sprint 3 (Thanh toán, bàn giao & nghiệp vụ):** Triển khai Task 8, 9, 10[cite: 3].

## 5. THIẾT KẾ KỸ THUẬT CHO NGHIỆP VỤ BACKEND NÂNG CAO
- **Implementation strategy for Task 10 requirements:**
  - **Order State Machine:** Xây dựng luồng chuyển đổi trạng thái nghiêm ngặt và chặn các chuyển đổi sai quy tắc bằng hàm `assertTransition`[cite: 7]. Có unit/integration test chứng minh chặn lỗi thành công[cite: 7].
  - **Payment Idempotency:** Sử dụng `Idempotency-Key` để đảm bảo cùng một yêu cầu thanh toán không bị trừ tiền hoặc đặt đơn 2 lần[cite: 7].
  - **Concurrency Control (Optimistic Locking):** Dùng transaction kết hợp optimistic locking để kiểm soát tồn kho, tránh bán vượt quá nguyên liệu khi nhiều khách đặt đồng thời[cite: 7].
  - **Loyalty Points:** Xử lý áp mã giảm giá hợp lệ và cộng điểm tích lũy vào tài khoản khách hàng sau khi đơn chuyển sang PAID[cite: 7].
- **Order State Machine transitions and guard rules:**
  - **Luồng hợp lệ (Happy Path):** `PENDING` -> `PAID` -> `PREPARING` -> `READY` -> `COMPLETED`[cite: 7, 8].
  - **Luồng ngoại lệ (Exceptions):** `PENDING` chuyển sang `PAYMENT_FAILED` nếu thanh toán lỗi[cite: 8]. Từ `PENDING` hoặc `PAYMENT_FAILED` có thể chuyển sang `CANCELLED` (Hủy đơn)[cite: 8].
  - **Quy tắc Guard:** Mọi chuyển tiếp không theo các mũi tên chỉ định sẽ bị chặn lại; `COMPLETED` và `CANCELLED` là trạng thái kết thúc[cite: 7].

## 6. TIÊU CHÍ HOÀN THÀNH (DEFINITION OF DONE) & DEMO
- **Quality checklist (DoD) per task/increment:**
  - Code phải chạy được và không có lỗi build[cite: 8].
  - Thỏa mãn toàn bộ các tiêu chí chấp nhận của task[cite: 8].
  - Code phải được commit trên Git với mô tả rõ ràng và được review trong nhóm[cite: 8].
  - API bắt buộc phải validate dữ liệu đầu vào[cite: 8].
  - UI frontend phải xử lý được các trạng thái loading và lỗi cơ bản[cite: 8].
  - Có file README hướng dẫn chạy dự án[cite: 8].
- **End-to-End Demo & Handover checklist:**
  - Trình diễn thực tế luồng end-to-end: chọn sản phẩm -> giỏ hàng -> thanh toán -> xác nhận đơn[cite: 8].
  - Bàn giao mã nguồn qua Git, kèm file `docker-compose` khởi chạy toàn bộ hệ thống và README[cite: 8].
  - Trình bày Sprint Retrospective để đánh giá điều làm tốt và điều cần cải thiện[cite: 8].
  - Nhận phản hồi từ khách hàng / giảng viên và ghi nhận vào backlog cho phiên bản tiếp theo[cite: 8].