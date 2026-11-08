# Kế Hoạch Chỉnh Sửa Toàn Diện Lỗ Hổng Bảo Mật, Tính Tiền Backend & Quản Trị Hệ Thống (BrewLite)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển đổi 100% logic tính giá đơn hàng xuống Backend, ngăn chặn khách hàng tự chuyển đơn thành PAID, vá backdoor ZaloPay Sandbox, chuẩn hóa đổi điểm voucher, bảo vệ tài khoản Root Admin khỏi bị xóa qua API Customer, và bảo mật công thức món BOM.

**Architecture:** Áp dụng Domain-Driven Security & Clean Architecture trong NestJS: `OrdersService` đóng vai trò Domain Service chịu trách nhiệm truy vấn đơn giá thực tế từ DB; `OrdersController` siết chặt RBAC không cho khách tự cập nhật trạng thái đơn sang PAID; `PaymentsController` khóa endpoint test sandbox; `CustomersService` cô lập phạm vi chỉ tác động `Role.CUSTOMER`; `InventoryController` bảo vệ bí mật công thức BOM và giá vốn.

**Tech Stack:** NestJS 10, TypeScript, Prisma ORM, PostgreSQL, Vitest / Jest, Next.js 15, Zustand.

**Spec:** [bao_cao_ra_soat_toan_dien_code_brewlite.md](file:///C:/Users/Giavy/.gemini/antigravity/brain/64d237bc-d69e-4e83-a13a-b20d14239cf0/bao_cao_ra_soat_toan_dien_code_brewlite.md)

---

## Global Constraints

- Không làm gián đoạn luồng đặt hàng hiện tại của Frontend: Frontend chỉ gửi `productId`, `size`, `toppings`, `quantity`; Backend là chân lý duy nhất (Single Source of Truth) về giá tiền.
- Đảm bảo tính nhất quán kho nguyên vật liệu: Transaction + Optimistic Locking (`version` increment) không bị ảnh hưởng, triệt tiêu nguy cơ Deadlock bằng cách sắp xếp `ingredientId` tăng dần khi trừ kho.
- Phân quyền bất biến: Khách hàng chỉ có quyền xem đơn của mình và hủy đơn `PENDING` của mình. Chỉ có Webhook/Payment Service mới được chuyển đơn sang `PAID`. Chỉ có Barista/Admin mới được chuyển `PREPARING -> READY -> COMPLETED`.
- Bảo vệ tài khoản quản trị: Không cho phép bất kỳ API nào xóa hoặc chiếm quyền tài khoản Root Admin (`admin@brewlite.vn`).

---

## Danh Sách Task Triển Khai

### Task 1: Chuyển 100% Logic Tính Tiền Xuống Backend (`POST /orders`)
**Files:**
- Modify: `backend/src/orders/dto/create-order.dto.ts`
- Modify: `backend/src/orders/orders.service.ts`
- Test: `backend/src/orders/orders.service.spec.ts`

- [ ] **Step 1: Cập nhật `create-order.dto.ts`**
  - Xóa bỏ hoặc đánh dấu `@IsOptional()` trường `unitPrice` trong `OrderItemDto`.
- [ ] **Step 2: Triển khai tính toán đơn giá Server-side trong `OrdersService.createOrder`**
  - Truy vấn `Product.findMany` lấy `basePrice` thực tế từ DB.
  - Cộng phụ thu size từ cấu hình (S: 0, M: +5.000đ, L: +10.000đ hoặc `sizeUpchargeM/L`).
  - Cộng giá từng loại topping từ `ToppingRecipe.price`.
  - Tính `rawSubtotal = sum(serverUnitPrice * quantity)`.
  - Trừ trước (hoặc khóa) voucher cá nhân để chống dùng 1 voucher cho nhiều đơn cùng lúc.
  - Sắp xếp danh sách `requiredIngredients` theo `ingredientId ASC` để triệt tiêu Deadlock CSDL.

---

### Task 2: Chặn Khách Hàng Tự Duyệt Đơn `PAID` & Siết Chặt State Machine
**Files:**
- Modify: `backend/src/orders/orders.controller.ts`
- Modify: `backend/src/orders/orders.service.ts`
- Modify: `backend/src/payments/state-machine.helper.ts`

- [ ] **Step 1: Siết chặt phân quyền trong `updateOrderStatus`**
  - Nếu `userRole !== Role.STAFF && userRole !== Role.ADMIN`: Khách hàng CHỈ ĐƯỢC PHÉP chuyển đơn từ `PENDING` sang `CANCELLED`.
  - Nếu khách gửi bất kỳ trạng thái nào khác (`PAID`, `PREPARING`, `READY`, `COMPLETED`), ném ra `ForbiddenException('Khách hàng không có quyền tự chuyển trạng thái đơn hàng.')`.
- [ ] **Step 2: Cập nhật `state-machine.helper.ts`**
  - Đảm bảo `PENDING -> PAID` chỉ được thực hiện thông qua nội bộ `PaymentsService`.

---

### Task 3: Khóa Cổng ZaloPay Sandbox & Chống Replay Attack
**Files:**
- Modify: `backend/src/payments/payments.controller.ts`
- Modify: `backend/src/payments/payments.service.ts`

- [ ] **Step 1: Khóa endpoint `zalopay/confirm` và `zalopay/cancel`**
  - Đặt `@UseGuards(JwtAuthGuard, RolesGuard)` và `@Roles(Role.ADMIN)` hoặc vô hiệu hóa khi không phải dev.
- [ ] **Step 2: Chống Replay Attack trong `getZaloPayStatus`**
  - Bắt buộc kiểm tra `queryRes.amount === order.totalAmount`.
  - Lưu `appTransId` vào bản ghi `Order` hoặc `Payment` khi khởi tạo, không cho client tự truyền tùy tiện.
- [ ] **Step 3: Chống hồi sinh đơn `CANCELLED`**
  - Trong callback ZaloPay, nếu đơn đã quá hạn 5 phút bị hủy (`CANCELLED`), từ chối set `PAID` và ghi nhận để hoàn tiền.

---

### Task 4: Chuẩn Hóa Đổi Điểm Hạt Vàng & Chống Race Condition
**Files:**
- Modify: `backend/src/auth/auth.controller.ts`
- Modify: `backend/src/auth/auth.service.ts`

- [ ] **Step 1: Cập nhật Controller `redeem-points`**
  - Không nhận `discountPercent` và `minOrderAmount` từ body client.
  - Chỉ nhận `voucherCode` hoặc `rewardTierId`.
- [ ] **Step 2: Trừ điểm nguyên tử trong Service**
  - Dùng `updateMany` với `where: { id: userId, loyaltyPoints: { gte: points } }` để ngăn chặn hoàn toàn Race Condition âm điểm.
  - Lấy thông tin voucher chuẩn từ bảng `DiscountCode` trong DB kèm mức trần `maxDiscountAmount`.

---

### Task 5: Bảo Vệ Tài Khoản Root Admin & Phân Lập Khách Hàng
**Files:**
- Modify: `backend/src/customers/customers.service.ts`
- Modify: `backend/src/users/users.service.ts`
- Modify: `backend/src/users/dto/create-staff.dto.ts`

- [ ] **Step 1: Phân lập `CustomersService`**
  - Trong mọi hàm `getCustomerById`, `updateCustomer`, `deleteCustomer`, `toggleCustomerStatus`: bắt buộc kiểm tra `where: { id, role: Role.CUSTOMER }`. Nếu không phải khách hàng $\rightarrow$ từ chối ngay lập tức.
- [ ] **Step 2: Bảo vệ Root Admin & Chống tự khóa trong `UsersService`**
  - Chặn tự xóa / tự khóa chính mình: `if (id === currentUserId) throw BadRequest`.
  - Chặn xóa / sửa Root Admin: `if (user.email === 'admin@brewlite.vn') throw BadRequest`.
- [ ] **Step 3: Khóa quyền tạo Admin qua `/staff`**
  - `CreateStaffDto` mặc định gán `role = Role.STAFF`, không cho phép tự phong `ADMIN`.

---

### Task 6: Bảo Mật Bí Mật Kinh Doanh BOM & Giá Vốn Trong Inventory
**Files:**
- Modify: `backend/src/inventory/inventory.controller.ts`
- Modify: `backend/src/products/products.service.ts`
- Modify: `backend/src/inventory/inventory.service.ts`

- [ ] **Step 1: Thêm Guard cho API kho và công thức**
  - `GET /inventory/ingredients` và `GET /inventory/recipes` $\rightarrow$ Thêm `@UseGuards(JwtAuthGuard, RolesGuard)` và `@Roles(Role.ADMIN)`.
- [ ] **Step 2: Lược bỏ dữ liệu nhạy cảm khỏi `GET /products` của khách**
  - Bỏ `recipes`, `cogsSizeS/M/L`, `grossProfitS`, `marginPercentS` khỏi response công khai.
- [ ] **Step 3: Chặn Cascade Delete nguy hiểm**
  - Trong `deleteIngredient`, kiểm tra nếu nguyên liệu đang nằm trong công thức `Recipe` thì cấm xóa cứng.

---

### Task 7: Kiểm Thử Tích Hợp Toàn Diện (End-to-End Verification)
- [ ] Chạy bộ test tự động `npm test` trong `backend` và `frontend`.
- [ ] Dùng Postman kiểm thử các kịch bản tấn công: giá 0đ, confirm không token, đổi điểm voucher 100%, tự duyệt PAID, xóa admin $\rightarrow$ Tất cả phải bị từ chối với mã lỗi 400/401/403 tương ứng.
