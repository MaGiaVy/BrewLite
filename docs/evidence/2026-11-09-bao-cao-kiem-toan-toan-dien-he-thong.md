# BÁO CÁO TOÀN DIỆN: RÀ SOÁT BẢO MẬT API BACKEND & ĐỒNG BỘ LUỒNG HỆ THỐNG BREWLITE

> **Người thực hiện:** Đội ngũ 5 Subagent Chuyên trách (Orders, Payments, Auth/RBAC, Inventory/BOM, Frontend/E2E)  
> **Thời gian thực hiện:** Ngày 09 tháng 11 năm 2026  
> **Nguyên tắc tuân thủ:** Chỉ đọc, kiểm thử, phân tích và báo cáo (Read-only Audit). Tuyệt đối không can thiệp sửa mã nguồn khi chưa có sự đồng ý của Trưởng nhóm / Người dùng.

---

## I. BẢNG TỔNG HỢP NGUY CƠ BẢO MẬT (RISK MATRIX)

| Phân vùng kiểm tra | 🔴 CRITICAL | 🟠 HIGH | 🟡 MEDIUM | 🔵 LOW / INFO | Tổng cộng |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **1. Đơn hàng, Tính giá & Vouchers** | 4 | 4 | 4 | 2 | **14** |
| **2. Cổng Thanh toán & Webhook** | 2 | 3 | 3 | 1 | **9** |
| **3. Xác thực & Phân quyền RBAC** | 1 | 3 | 3 | 2 | **9** |
| **4. Kho hàng, Vật tư BOM & Giá vốn** | 1 | 3 | 3 | 4 | **11** |
| **5. Giao diện Frontend & Tích hợp Luồng** | 2 | 2 | 3 | 2 | **9** |
| **TỔNG HỢP TOÀN BỘ HỆ THỐNG** | **10** | **15** | **16** | **11** | **52** |

---

## II. DANH SÁCH 10 LỖ HỔNG MỨC ĐỘ NGUY HIỂM CAO NHẤT (🔴 CRITICAL)

### 1. [CRITICAL - Đơn hàng & Kho] Kẹt & Thất thoát vĩnh viễn kho BOM khi đơn hàng bị `PAYMENT_FAILED`
- **File:** `backend/src/orders/orders.service.ts` (Dòng 62–68, 724, 994–1024)
- **Mô tả:** 
  1. Khi tạo đơn `POST /orders`, hệ thống lập tức trừ kho nguyên liệu.
  2. Nếu thanh toán thất bại (`status = PAYMENT_FAILED`), cronjob 5 phút `cancelExpiredPendingOrders` chỉ tìm đơn `PENDING` nên **hoàn toàn bỏ qua đơn thất bại**.
  3. Khách hàng không thể hủy đơn thất bại (dòng 724 chặn chỉ cho hủy `PENDING`).
  4. Nếu xóa đơn hàng thất bại (`DELETE /orders/:id`), hàm `deleteOrder` chỉ hoàn kho cho đơn `PENDING`, xóa sổ đơn thất bại mà **KHÔNG HOÀN TRẢ KHO**.
- **Hậu quả:** Nguyên vật liệu bị giam vĩnh viễn hoặc mất trắng khỏi tồn kho thực tế.
- **Khuyến nghị:** Thêm `status: { in: [PENDING, PAYMENT_FAILED] }` vào cronjob quét hết hạn, cho phép hủy đơn `PAYMENT_FAILED` và hoàn kho khi xóa.

### 2. [CRITICAL - Đơn hàng & Voucher] Lỗ hổng tái sử dụng Voucher vô hạn (Voucher Concurrency Exploit)
- **File:** `backend/src/orders/orders.service.ts` (Dòng 417–440, 557–559, 846–875)
- **Mô tả:** Khi khách đặt hàng, hệ thống không hề trừ số lượng voucher trong `UserVoucher` mà hoãn đến khi Barista đổi trạng thái đơn sang `COMPLETED` (15–30 phút sau) mới xóa voucher.
- **Hậu quả:** Khách hàng sở hữu 1 voucher giảm 50% có thể gọi liên tục hàng chục request `POST /orders` cùng lúc và tất cả các đơn đều được giảm 50%.
- **Khuyến nghị:** Trừ hoặc tạm khóa (reserve) voucher ngay trong `$transaction` khi tạo đơn. Hoàn lại nếu đơn bị hủy.

### 3. [CRITICAL - Đơn hàng & Voucher] Mã giảm giá Hardcoded fallback không giới hạn số lần và người dùng
- **File:** `backend/src/orders/orders.service.ts` (Dòng 359–385, 443–445)
- **Mô tả:** Service định nghĩa từ điển tĩnh `DISCOUNT_RATES` với các mã giảm giá khủng như `BREW50` (giảm 50%), `BREW20` (giảm 20%). Các mã này không được lưu trong DB, không có thời hạn hết hạn, không giới hạn số lần sử dụng trên mỗi user.
- **Hậu quả:** Bất kỳ khách nào nhập `BREW50` đều được giảm giá vô hạn mỗi ngày.
- **Khuyến nghị:** Xóa bỏ hoàn toàn dictionary tĩnh; quản lý toàn bộ voucher tập trung trong bảng `DiscountCode`.

### 4. [CRITICAL - Đơn hàng & State Machine] Thiếu Optimistic Locking khi chuyển trạng thái đơn hàng (`updateOrderStatus`)
- **File:** `backend/src/orders/orders.service.ts` (Dòng 828, 877, 896)
- **Mô tả:** Bảng `Order` có trường `version` nhưng `updateOrderStatus` lại dùng `prisma.order.update({ where: { id: orderId } })` mà không kiểm tra version hiện tại.
- **Hậu quả:** Race condition xảy ra khi Barista bắt đầu pha (`PREPARING`) cùng lúc Admin hủy đơn (`CANCELLED`). Đơn vừa được hoàn kho vừa được pha chế mang đi giao cho khách.
- **Khuyến nghị:** Dùng `updateMany` với `where: { id: orderId, version: currentOrder.version }` và `version: { increment: 1 }`.

### 5. [CRITICAL - Thanh toán] Backdoor bypass thanh toán qua `POST /payments/zalopay/confirm`
- **File:** `backend/src/payments/payments.controller.ts` (Dòng 81–106), `backend/src/payments/payments.service.ts` (Dòng 560–610)
- **Mô tả:** Endpoint này dùng cho sandbox test nhưng lại phơi ra cho mọi user đã đăng nhập. Khách hàng chỉ cần gửi `{ "orderId": 123 }`, server sẽ tự sinh callback giả mạo có chữ ký Key2 hợp lệ và set đơn thành `PAID`.
- **Hậu quả:** Mua hàng 0đ, tự động nhận nước và tích lũy điểm thưởng mà không cần thanh toán thực tế.
- **Khuyến nghị:** Vô hiệu hóa endpoint trên production hoặc chỉ cho phép quyền `Role.ADMIN` với điều kiện môi trường non-production.

### 6. [CRITICAL - Thanh toán] Bỏ qua kiểm tra số tiền (`amount`) trong Webhook Callback ZaloPay
- **File:** `backend/src/payments/payments.service.ts` (Dòng 421–448)
- **Mô tả:** Trong `handleZaloPayCallback`, sau khi verify MAC, server chỉ lấy `amount` từ payload để ghi nhận mà **hoàn toàn không so sánh với `order.totalAmount`**.
- **Hậu quả:** Nếu đơn hàng 500.000đ nhưng callback báo thanh toán 1.000đ, server vẫn cập nhật đơn sang `PAID`.
- **Khuyến nghị:** Bổ sung so sánh: `if (Number(amount) !== order.totalAmount) return { return_code: 0, return_message: "amount mismatch" };`.

### 7. [CRITICAL - Xác thực & RBAC] `JwtStrategy` không truy vấn DB kiểm tra `isActive` và thu hồi Token
- **File:** `backend/src/auth/jwt.strategy.ts` (Dòng 22–28)
- **Mô tả:** Token JWT có hạn 7 ngày. `JwtStrategy` chỉ giải mã token trên RAM, không inject `PrismaService` để kiểm tra tài khoản có bị khóa (`isActive: false`) hoặc đã bị xóa hay chưa.
- **Hậu quả:** Nhân viên bị sa thải hoặc khách hàng bị ban tài khoản vẫn có thể cầm Access Token cũ gửi request thực thi API trong suốt 7 ngày tiếp theo.
- **Khuyến nghị:** Inject `PrismaService` vào `JwtStrategy`, truy vấn `where: { id: payload.sub }` và ném `UnauthorizedException` nếu `!user || !user.isActive`.

### 8. [CRITICAL - Kho & BOM] Lost Update & Bỏ qua Optimistic Locking trong `updateIngredient`
- **File:** `backend/src/inventory/inventory.service.ts` (Dòng 193–212)
- **Mô tả:** API `PATCH /inventory/ingredients/:id` cho phép sửa tên, đơn giá và số lượng tồn kho `stock` nhưng lại dùng `prisma.ingredient.update({ where: { id } })` không kiểm tra `version`.
- **Hậu quả:** Nếu Admin sửa thông tin nguyên liệu đúng lúc có đơn hàng đang trừ kho, số lượng trừ kho của đơn hàng sẽ bị ghi đè mất dấu (Lost Update).
- **Khuyến nghị:** Bắt buộc cập nhật với `where: { id, version: current.version }` và `version: { increment: 1 }`.

### 9. [CRITICAL - Frontend] Crash ứng dụng do lỗi TDZ (Temporal Dead Zone) trong `ProductDetailModal.tsx`
- **File:** `frontend/src/app/components/ProductDetailModal.tsx` (Dòng 137, 149)
- **Mô tả:** Biến `isCurrentSizeOutOfStock` (dòng 137) gọi đến biến `selectedSize` trước khi biến này được khai báo ở dòng 149 (`useState<"S" | "M" | "L">("M")`).
- **Hậu quả:** Trình duyệt ném lỗi `ReferenceError: Cannot access 'selectedSize' before initialization`, modal chi tiết món bị sập trắng hoàn toàn khi khách bấm xem món.
- **Khuyến nghị:** Chuyển khai báo `isCurrentSizeOutOfStock` xuống dưới `selectedSize`.

### 10. [CRITICAL - Frontend & Nghiệp vụ] Mất 100% dữ liệu tuỳ chỉnh (Đường, Đá, Nhiệt độ, Ghi chú) đến quầy Barista
- **File:** `frontend/src/app/cart/page.tsx` (Dòng 1101–1153), `frontend/src/app/staff/page.tsx` (Dòng 1445)
- **Mô tả:** Khi khách bấm đặt hàng, giỏ hàng chỉ gửi `productId, size, toppings, quantity, unitPrice`. Các trường `sugarLevel`, `iceLevel`, `temperature`, `notes` bị bỏ rơi khỏi payload API backend và chỉ lưu tạm vào `localStorage` của máy khách.
- **Hậu quả:** Màn hình KDS của Barista lấy đơn từ database backend nên không biết khách dặn "Không đường", "Ít đá", "Dị ứng sữa", dẫn đến pha sai toàn bộ nước uống cho khách.
- **Khuyến nghị:** Bổ sung các trường tuỳ chỉnh vào model `OrderItem` trong Prisma schema và DTO backend, đồng thời gửi đầy đủ từ giỏ hàng.

---

## III. CÁC LỖ HỔNG MỨC ĐỘ CAO (🟠 HIGH) CẦN KHẮC PHỤC TRƯỚC KHI GO-LIVE

1. **Leo thang đặc quyền ADMIN qua `updateStaff`:** `createStaff` chặn không cho tạo ADMIN nếu caller không phải Root Admin, nhưng `updateStaff` lại quên kiểm tra điều này khi cập nhật `role: ADMIN`.
2. **Root Admin bị đổi email làm mất quyền bảo vệ tối cao:** `updateStaff` chặn đổi role và isActive của `admin@brewlite.vn` nhưng lại cho phép đổi email, khiến tài khoản Root Admin mất nhận diện và có thể bị xóa vĩnh viễn.
3. **Admin tự hạ quyền hoặc hạ quyền Admin duy nhất:** Hệ thống chỉ bảo vệ Admin duy nhất khi `isActive: false`, không kiểm tra khi đổi role thành `STAFF`.
4. **Spoofing tên sản phẩm (`productName`):** Client gửi `productName` tùy ý trong DTO được lưu thẳng vào DB và hiển thị trên màn hình Barista KDS.
5. **Âm điểm Hạt Vàng (`loyaltyPoints < 0`):** Khi hủy đơn đã thanh toán, hệ thống decrement điểm mà không kiểm tra số dư hiện tại, dẫn đến điểm âm nếu khách đã kịp dùng điểm đổi voucher.
6. **Lạm phát tồn kho ảo (Phantom Inventory) với bao bì phụ trợ:** Bao bì phụ trợ hết kho lúc đặt không bị trừ, nhưng khi đơn bị hủy lại được cộng hoàn kho +1 chiếc.
7. **Nhảy cóc trạng thái sang `PAID` không qua cổng thanh toán:** Staff/Admin có thể PATCH đơn `PENDING -> PAID` mà không hề sinh bản ghi giao dịch thanh toán trong bảng `Payment`.
8. **Hardcoded Secret Key ZaloPay Sandbox trong code:** Fallback key1, key2 nằm trực tiếp trong file mã nguồn thay vì ép buộc đọc từ biến môi trường.
9. **Lỗi Idempotency Callback ZaloPay lùi trạng thái đơn:** Khi đơn đã sang `PREPARING`/`READY`, callback đến muộn cập nhật lùi về `PAID` và văng lỗi P2002 làm ZaloPay retry liên tục.
10. **Hủy trên Cổng ZaloPay không giải phóng kho:** Khách bấm hủy trên cổng ZaloPay chỉ ghi log, không chuyển trạng thái `CANCELLED`, giữ treo nguyên liệu suốt 5 phút.
11. **Xóa sạch Audit Logs khi xóa nguyên liệu (`onDelete: Cascade`):** Bảng `InventoryLog` bị xóa toàn bộ lịch sử kiểm kê tài chính khi một nguyên vật liệu bị xóa.
12. **Bỏ qua hạn dùng JWT trong `ProductsController.extractUserFromRequest`:** HMAC signature khớp nhưng quên kiểm tra `exp`, token Admin hết hạn từ nhiều năm trước vẫn xem được công thức BOM và giá vốn.
13. **Rò rỉ giá vốn Topping qua API công khai `GET /inventory/pricing-config`:** Khách vãng lai và đối thủ đọc được trọn vẹn chi phí giá vốn của từng topping.
14. **Hở giao diện KDS Barista (`/staff`) khi khách gõ trực tiếp URL:** Thiếu kiểm tra phân quyền trong Early Return Guard, gây lộ giao diện và bão lỗi 403 network.
15. **Giỏ hàng (`/cart`) không re-validate tình trạng hết ly (`outOfStockSizes`):** Khách đặt món size đã hết ly bấm checkout bị lỗi 400 đỏ chung chung mà không rõ món nào hết size.

---

## IV. LỘ TRÌNH KHUYẾN NGHỊ KHẮC PHỤC (ACTION PLAN)

### Giai đoạn 1: Hotfix Khẩn cấp (Sửa lỗi Crash & Lỗ hổng Trục lợi Tài chính)
- [ ] **Fix 1.1:** Sửa lỗi TDZ `selectedSize` trong `ProductDetailModal.tsx` để khôi phục modal chọn món.
- [ ] **Fix 1.2:** Chặn Backdoor `POST /payments/zalopay/confirm` (chỉ cho phép dev/admin và kiểm tra NODE_ENV).
- [ ] **Fix 1.3:** Kiểm tra đối soát `amount === order.totalAmount` trong ZaloPay Callback.
- [ ] **Fix 1.4:** Khóa/trừ Voucher nguyên tử khi tạo đơn và loại bỏ từ điển `DISCOUNT_RATES` hardcoded.
- [ ] **Fix 1.5:** Thêm truy vấn `isActive: true` vào `JwtStrategy.validate` để thu hồi token ngay khi tài khoản bị khóa/xóa.

### Giai đoạn 2: Bảo vệ Kho hàng & Máy trạng thái
- [ ] **Fix 2.1:** Quét hết hạn và hoàn kho cho cả đơn hàng `PAYMENT_FAILED`.
- [ ] **Fix 2.2:** Thêm Optimistic Locking (`version`) vào `updateOrderStatus` và `updateIngredient`.
- [ ] **Fix 2.3:** Sửa lỗi lạm phát kho ảo bao bì phụ trợ (chỉ hoàn trả đúng số lượng thực tế đã trừ).
- [ ] **Fix 2.4:** Chống âm điểm Hạt Vàng khi hủy đơn và thêm constraint DB.
- [ ] **Fix 2.5:** Không cho phép nhảy cóc sang `PAID` qua API PATCH thông thường.

### Giai đoạn 3: Bảo mật Phân quyền & Hoàn thiện Luồng Người dùng
- [ ] **Fix 3.1:** Chặn đổi email Root Admin và kiểm tra quyền Root Admin khi thăng cấp role ADMIN.
- [ ] **Fix 3.2:** Ẩn trường `cogs` trong `GET /inventory/pricing-config` đối với khách vãng lai.
- [ ] **Fix 3.3:** Sửa Early Return Guard tại `/staff` để ngăn chặn lộ giao diện KDS.
- [ ] **Fix 3.4:** Bổ sung lưu trữ và truyền tải dữ liệu tuỳ chỉnh món (Đường, Đá, Nhiệt độ, Ghi chú) từ Giỏ hàng sang KDS Barista.
- [ ] **Fix 3.5:** Bổ sung bộ lọc Cốt lõi / Phụ trợ và sửa lỗi xung đột đơn vị g/ml tại kho Bao bì Admin.

---
*Báo cáo đã sẵn sàng để trình duyệt. Hệ thống không tự ý sửa đổi bất kỳ file code nào.*
