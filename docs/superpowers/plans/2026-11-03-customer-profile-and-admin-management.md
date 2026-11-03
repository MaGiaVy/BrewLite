# Customer Profile, Admin Customer Management & Packaging Consumables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng tính năng cho phép Khách hàng tự cập nhật hồ sơ/đổi mật khẩu an toàn, bổ sung phân hệ Admin Quản lý Khách hàng (chặn sửa điểm hạt vàng, tạm khóa, xóa thông minh), dọn dẹp trường Vị trí/Chức vụ của nhân viên, và tích hợp quản lý Bao bì & Vật tư tiêu hao (Ly, Nắp, Ống hút, Bịch, Muỗng) vào hệ thống Tồn kho với cơ chế phân loại Cốt lõi vs Phụ trợ không khóa món.

**Architecture:** 
- Backend NestJS: 
  - `AuthModule`: Endpoint `PATCH /auth/profile` (xác thực `currentPassword` bằng bcrypt trước khi lưu mật khẩu mới).
  - `CustomersModule`: Endpoint `/admin/customers` (quản lý khách hàng, toggle `isActive`, smart delete bảo toàn đơn hàng, chặn nhận param `loyaltyPoints`).
  - `UsersModule`: Lược bỏ ràng buộc `position` của nhân viên.
  - `InventoryModule` & Prisma: Mở rộng `Ingredient` với `type` (`INGREDIENT` | `PACKAGING`) và `isRequiredForSale` (`boolean`). Logic bán hàng: Vật tư cốt lõi hết kho -> khóa món; vật tư phụ trợ (bịch, muỗng, ống hút) hết kho -> vẫn cho bán món, chỉ cảnh báo kho.
- Frontend Next.js:
  - `EditProfileModal`: Tích hợp vào `LoyaltyDrawer` cho khách hàng sửa Họ tên, SĐT, Đổi mật khẩu.
  - `CustomerManagementSection`: Tab "Khách hàng" mới trong `/admin` với đầy đủ CRUD an toàn.
  - `StaffManagementSection`: Xóa bỏ ô nhập và cột "Vị trí công việc & Chức vụ".
  - `InventorySection`: Bổ sung Tab lọc "Nguyên liệu pha chế" vs "Bao bì & Vật tư", badge phân loại Cốt lõi vs Phụ trợ.

**Tech Stack:** NestJS, Prisma ORM, PostgreSQL, bcrypt, Next.js 14 (App Router), Tailwind CSS, Lucide / Material Symbols, Zustand.

**Spec & Design Decisions:**
1. Khách hàng: Cho phép sửa Họ tên, SĐT; đổi mật khẩu yêu cầu nhập Mật khẩu hiện tại + Mật khẩu mới + Nhập lại mật khẩu mới. Email cố định làm mã định danh.
2. Admin Quản lý Khách hàng: Thêm mới (mật khẩu mặc định 123456, điểm = 0), Khóa/Mở khóa tài khoản, Xóa thông minh (hard delete nếu chưa có đơn hàng, soft delete/khóa nếu đã có đơn), Chỉnh sửa (không được can thiệp điểm hạt vàng).
3. Admin Quản lý Nhân viên: Bỏ hoàn toàn trường "Vị trí công việc & Chức vụ" ở modal Thêm, modal Sửa và ẩn cột Vị trí trên bảng nhân viên, chỉ giữ Vai trò hệ thống (Admin / Nhân viên).
4. Bao bì & Vật tư tiêu hao (Ly, Nắp, Ống hút, Bịch, Muỗng): Quản lý chung trong bảng Kho `Ingredient` có phân loại `type` (`INGREDIENT` | `PACKAGING`) và cờ `isRequiredForSale`. Hết bịch/muỗng (`isRequiredForSale = false`) thì quán **vẫn bán bình thường**, chỉ hiện cảnh báo vàng; hết cà phê/sữa/ly (`isRequiredForSale = true`) mới tự động khóa món (Hết hàng).

## Global Constraints

- Backend endpoints cho Admin phải được bảo vệ bởi `JwtAuthGuard` và `RolesGuard` với `@Roles(Role.ADMIN)`.
- Tuyệt đối không cho phép Admin hoặc Khách hàng trực tiếp sửa đổi hoặc thêm mới `loyaltyPoints` qua các API cập nhật hồ sơ/khách hàng.
- Khi đổi mật khẩu, backend bắt buộc phải xác minh `currentPassword` khớp với hash trong DB rồi mới cho phép mã hóa `newPassword`.
- Không được làm vỡ các mối quan hệ khoá ngoại (Foreign Key) với bảng `Order` khi xóa người dùng.
- Vật tư phụ trợ hết hàng không được làm gián đoạn luồng đặt món của khách hàng trên giao diện đặt đồ.

## Review Focus

- Nhập sai mật khẩu hiện tại khi đổi mật khẩu -> Phải trả về lỗi 400 Bad Request rõ ràng, không được thay đổi mật khẩu trong DB.
- Admin cố tình gửi payload kèm `{ loyaltyPoints: 9999 }` lên API tạo/sửa khách hàng -> Backend phải loại bỏ hoàn toàn hoặc không cập nhật điểm.
- Xóa khách hàng đã có đơn hàng -> Không được ném lỗi Prisma Foreign Key Constraint (P2003); phải tự động chuyển tài khoản sang `isActive: false` và thông báo cho admin.
- Khách hàng bị Admin Tạm khóa (`isActive: false`) -> Đăng nhập vào hệ thống phải bị chặn ngay với thông báo tài khoản bị khóa.
- Bịch mang đi / Muỗng nhựa hết tồn kho (= 0) -> Đồ uống liên quan KHÔNG được chuyển sang trạng thái "Hết hàng", khách vẫn đặt mua bình thường.
- Ly giấy Size M hết tồn kho (= 0) -> Đồ uống size M phải tự động báo hết hàng.

---

### Task 1: Backend Customer Profile Update (`PATCH /auth/profile`)

**Files:**
- Create: `backend/src/auth/dto/update-profile.dto.ts`
- Modify: `backend/src/auth/auth.controller.ts`
- Modify: `backend/src/auth/auth.service.ts`
- Test: `backend/test/auth-profile.e2e-spec.ts`

**Interfaces:**
- Consumes: `JwtAuthGuard`, `AuthRequest` (`req.user.userId`), `PrismaService`.
- Produces: `PATCH /auth/profile` nhận `UpdateProfileDto` trả về profile đã cập nhật `{ id, email, fullName, phone, role, loyaltyPoints }`.

- [ ] **Step 1: Viết test failing cho `PATCH /auth/profile`**
Tạo test `backend/test/auth-profile.e2e-spec.ts`:
- Khách hàng cập nhật Họ tên & SĐT thành công mà không đổi mật khẩu.
- Đổi mật khẩu thành công khi cung cấp đúng `currentPassword` và `newPassword`.
- Đổi mật khẩu thất bại khi `currentPassword` sai (kỳ vọng 400 Bad Request).

- [ ] **Step 2: Chạy test để xác nhận test fail**
Run: `npm --prefix backend test -- auth-profile`
Expected: FAIL

- [ ] **Step 3: Tạo `UpdateProfileDto`**
Tạo file `backend/src/auth/dto/update-profile.dto.ts` với `fullName`, `phone`, `currentPassword`, `newPassword` (tối thiểu 6 ký tự).

- [ ] **Step 4: Cài đặt logic cập nhật profile trong `AuthService`**
Trong `backend/src/auth/auth.service.ts`:
- Tìm user theo `userId`.
- Nếu có `dto.newPassword`: Kiểm tra `dto.currentPassword` qua `bcrypt.compare`. Nếu sai ném `BadRequestException('Mật khẩu hiện tại không chính xác')`. Hash mật khẩu mới bằng `bcrypt.hash(..., 10)`.
- Cập nhật Prisma `user.update` và trả về safe user object.

- [ ] **Step 5: Khai báo endpoint trong `AuthController`**
Thêm route `@Patch('profile')` bảo vệ bởi `JwtAuthGuard`.

- [ ] **Step 6: Chạy test để xác nhận test pass**
Run: `npm --prefix backend test -- auth-profile`
Expected: PASS

- [ ] **Step 7: Commit backend profile update**
```bash
git add backend/src/auth backend/test/auth-profile.e2e-spec.ts
git commit -m "feat(auth): add customer profile update endpoint with password verification"
```

---

### Task 2: Backend Admin Customer Management API (`/admin/customers`)

**Files:**
- Create: `backend/src/customers/dto/create-customer.dto.ts`
- Create: `backend/src/customers/dto/update-customer.dto.ts`
- Create: `backend/src/customers/customers.controller.ts`
- Create: `backend/src/customers/customers.service.ts`
- Create: `backend/src/customers/customers.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/customers-admin.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `JwtAuthGuard`, `RolesGuard`, `@Roles(Role.ADMIN)`.
- Produces: 
  - `GET /admin/customers`: Danh sách khách hàng kèm `loyaltyPoints`, `_count.orders`.
  - `POST /admin/customers`: Tạo khách hàng mới (điểm = 0, role = CUSTOMER).
  - `PATCH /admin/customers/:id`: Cập nhật khách hàng (chặn sửa points).
  - `PATCH /admin/customers/:id/status`: Khóa / Mở khóa tài khoản.
  - `DELETE /admin/customers/:id`: Xóa thông minh (hard delete nếu chưa có order, soft lock nếu đã có order).

- [ ] **Step 1: Viết test failing cho CRUD `/admin/customers`**
Tạo test `backend/test/customers-admin.e2e-spec.ts`:
- Lấy danh sách khách hàng.
- Tạo khách hàng mới với `loyaltyPoints = 0` (loại bỏ trường points nếu gửi kèm).
- Khóa / Mở khóa tài khoản.
- Xóa khách chưa có đơn -> Hard delete.
- Xóa khách đã có đơn -> Chuyển sang `isActive: false` mà không crash DB.

- [ ] **Step 2: Chạy test để xác nhận test fail**
Run: `npm --prefix backend test -- customers-admin`
Expected: FAIL

- [ ] **Step 3: Cài đặt DTOs cho Customer**
Tạo `CreateCustomerDto` (email, fullName, phone, password mặc định 123456) và `UpdateCustomerDto` (tuyệt đối không chứa `loyaltyPoints`).

- [ ] **Step 4: Cài đặt `CustomersService` với Smart Delete**
Triển khai các phương thức nghiệp vụ; trong `deleteCustomer`: đếm số đơn hàng của user, nếu = 0 thì `delete`, nếu > 0 thì chuyển `isActive = false` kèm thông báo bảo toàn dữ liệu.

- [ ] **Step 5: Cài đặt `CustomersController` và đăng ký vào `AppModule`**
Route `@Controller('admin/customers')`, phân quyền Admin. Đăng ký module vào `AppModule`.

- [ ] **Step 6: Chạy test để xác nhận test pass**
Run: `npm --prefix backend test -- customers-admin`
Expected: PASS

- [ ] **Step 7: Commit backend customer management**
```bash
git add backend/src/customers backend/src/app.module.ts backend/test/customers-admin.e2e-spec.ts
git commit -m "feat(admin): implement customer management API with smart delete and safe points"
```

---

### Task 3: Backend & Frontend Cleanup Staff Position / Chức Vụ

**Files:**
- Modify: `backend/src/users/dto/create-staff.dto.ts`
- Modify: `backend/src/users/dto/update-staff.dto.ts`
- Modify: `backend/src/users/users.service.ts`
- Modify: `frontend/src/app/admin/components/StaffManagementSection.tsx`

**Interfaces:**
- Lược bỏ trường `position` khỏi payload và form nhập liệu của nhân viên; bảo toàn tính tương thích với database.

- [ ] **Step 1: Cập nhật DTO backend và service**
Chuyển `position` thành optional trong DTOs; trong service gán giá trị mặc định `"Nhân viên"` khi tạo.

- [ ] **Step 2: Dọn dẹp form và bảng trong `StaffManagementSection.tsx`**
Xóa mảng `POSITION_SUGGESTIONS`, xóa state `position`, xóa input "Vị trí công việc & Chức vụ *" trong modal, và ẩn cột Vị trí trên bảng nhân viên.

- [ ] **Step 3: Kiểm tra build TypeScript**
Run: `npx --prefix frontend tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit cleanup staff position**
```bash
git add backend/src/users frontend/src/app/admin/components/StaffManagementSection.tsx
git commit -m "refactor(staff): remove job position input and table column, retain system role only"
```

---

### Task 4: Backend & Database Packaging & Consumables Management (Bao bì & Vật tư)

**Files:**
- Modify: `backend/prisma/schema.prisma:61-75`
- Modify: `backend/src/inventory/dto/inventory.dto.ts`
- Modify: `backend/src/inventory/inventory.service.ts`
- Modify: `backend/prisma/seed.ts` (hoặc dữ liệu mẫu nguyên vật liệu)
- Test: `backend/test/inventory-packaging.e2e-spec.ts`

**Interfaces:**
- Prisma: Thêm trường `type String @default("INGREDIENT")` (`INGREDIENT` | `PACKAGING`) và `isRequiredForSale Boolean @default(true)`.
- Logic kiểm tra hết hàng: Chỉ các nguyên vật liệu/bao bì có `isRequiredForSale: true` mới làm món bị `isOutOfStock = true`. Các vật tư phụ trợ như Bịch mang đi, Muỗng, Ống hút (`isRequiredForSale: false`) khi stock = 0 KHÔNG làm món bị khóa.

- [ ] **Step 1: Cập nhật Prisma Schema & Chạy Migration**
Trong `backend/prisma/schema.prisma` tại model `Ingredient`:
```prisma
model Ingredient {
  id               Int             @id @default(autoincrement())
  code             String          @unique
  name             String
  unit             String
  stock            Float           @default(0)
  minThreshold     Float           @default(100)
  costPerUnit      Float           @default(0)
  type             String          @default("INGREDIENT") // INGREDIENT | PACKAGING
  isRequiredForSale Boolean        @default(true)        // True = Hết là khóa món; False = Hết vẫn cho bán, chỉ cảnh báo kho
  version          Int             @default(0)
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
  recipes          Recipe[]
  toppingRecipes   ToppingRecipe[]
  logs             InventoryLog[]
}
```
Run: `npx --prefix backend prisma generate` và áp dụng migration.

- [ ] **Step 2: Viết test failing cho logic Vật tư cốt lõi vs Phụ trợ**
Tạo test `backend/test/inventory-packaging.e2e-spec.ts`:
- Khi ly size M (`isRequiredForSale: true`) hết hàng -> Món size M bị tính là hết hàng (`availableServings = 0`).
- Khi bịch mang đi / muỗng (`isRequiredForSale: false`) hết hàng -> Món vẫn còn hàng bình thường (`availableServings > 0`).

- [ ] **Step 3: Cập nhật `InventoryService` và DTOs**
- Trong `inventory.dto.ts`: Bổ sung `type?: string` và `isRequiredForSale?: boolean` vào `CreateIngredientDto` và `UpdateIngredientDto`.
- Trong `inventory.service.ts`:
  - Format ingredient trả về thêm `type` và `isRequiredForSale`.
  - Cập nhật hàm tính toán phục vụ khả dụng (`availableServings` / món khả dụng): Chỉ xét các nguyên liệu có `isRequiredForSale === true`.

- [ ] **Step 4: Bổ sung seed dữ liệu Bao bì mẫu**
Thêm các bao bì chuẩn quán cà phê vào database nếu chưa có:
- `PACK_CUP_S`, `PACK_CUP_M`, `PACK_CUP_L`: Ly giấy các size (`type: "PACKAGING"`, `isRequiredForSale: true`, unit: "cái").
- `PACK_LID`: Nắp ly (`type: "PACKAGING"`, `isRequiredForSale: true`, unit: "cái").
- `PACK_STRAW`: Ống hút (`type: "PACKAGING"`, `isRequiredForSale: false`, unit: "cái").
- `PACK_BAG_T`: Bịch chữ T / Túi mang về (`type: "PACKAGING"`, `isRequiredForSale: false`, unit: "cái").
- `PACK_SPOON`: Muỗng nhựa (`type: "PACKAGING"`, `isRequiredForSale: false`, unit: "cái").

- [ ] **Step 5: Chạy test để xác nhận test pass**
Run: `npm --prefix backend test -- inventory-packaging`
Expected: PASS

- [ ] **Step 6: Commit backend packaging & consumables**
```bash
git add backend/prisma backend/src/inventory backend/test/inventory-packaging.e2e-spec.ts
git commit -m "feat(inventory): add packaging consumables with required-for-sale constraint logic"
```

---

### Task 5: Frontend Customer Profile Edit Modal (`EditProfileModal.tsx` & `LoyaltyDrawer.tsx`)

**Files:**
- Create: `frontend/src/app/components/EditProfileModal.tsx`
- Modify: `frontend/src/app/components/LoyaltyDrawer.tsx`

**Interfaces:**
- Consumes: `apiFetch` từ `authStore`, `useAuthStore` (`user`, `refreshProfile`).
- Produces: Modal cho phép sửa Họ tên, SĐT, Đổi mật khẩu với 3 ô xác thực; cập nhật store ngay lập tức sau khi lưu thành công.

- [ ] **Step 1: Tạo component `EditProfileModal.tsx`**
- Form fields: Email (chỉ đọc), Họ và tên (bắt buộc), Số điện thoại.
- Khối "Đổi mật khẩu": Mật khẩu hiện tại, Mật khẩu mới (>= 6 ký tự), Xác nhận mật khẩu mới.
- Xử lý submit gọi `PATCH /auth/profile`. Hiển thị lỗi hoặc toast thành công.

- [ ] **Step 2: Nhúng nút "Chỉnh sửa hồ sơ" vào `LoyaltyDrawer.tsx`**
Thêm icon nút Sửa hồ sơ ở phần thông tin tài khoản; khi cập nhật xong gọi `refreshProfile()` để cập nhật drawer.

- [ ] **Step 3: Kiểm tra hiển thị và tương tác trực quan**
Xác nhận đổi mật khẩu đúng -> thành công; nhập sai mật khẩu cũ -> báo lỗi. Sửa tên/SĐT -> cập nhật mượt mà.

- [ ] **Step 4: Commit profile edit frontend**
```bash
git add frontend/src/app/components/EditProfileModal.tsx frontend/src/app/components/LoyaltyDrawer.tsx
git commit -m "feat(customer): add profile edit modal with password change confirmation"
```

---

### Task 6: Frontend Admin Customer Management Section (`CustomerManagementSection.tsx`)

**Files:**
- Create: `frontend/src/app/admin/components/CustomerManagementSection.tsx`
- Modify: `frontend/src/app/admin/page.tsx`

**Interfaces:**
- Consumes: API `/admin/customers` qua `apiFetch`.
- Produces: Tab "Khách hàng" trong Admin Portal với đầy đủ tính năng:
  - Bảng danh sách khách hàng (Badge điểm hạt vàng Read-Only).
  - Modal thêm khách hàng mới (mặc định 123456, KHÔNG có ô nhập điểm).
  - Modal chỉnh sửa khách hàng (KHÔNG có ô nhập điểm).
  - Nút Tạm khóa / Kích hoạt nhanh.
  - Modal xác nhận Xóa (Smart Delete với feedback thông minh).

- [ ] **Step 1: Tạo component `CustomerManagementSection.tsx`**
Triển khai bảng khách hàng, bộ lọc tìm kiếm/trạng thái, modal thêm/sửa, và nút Smart Delete.

- [ ] **Step 2: Tích hợp tab "Khách hàng" vào `frontend/src/app/admin/page.tsx`**
Thêm `"customers"` vào `AdminTab`, thêm vào `NAV_ITEMS`, và render section tương ứng.

- [ ] **Step 3: Chạy build frontend xác minh TypeScript**
Run: `npm --prefix frontend run build` hoặc `npx --prefix frontend tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit admin customer management frontend**
```bash
git add frontend/src/app/admin/components/CustomerManagementSection.tsx frontend/src/app/admin/page.tsx
git commit -m "feat(admin): add customer management section with safe points constraint and smart delete"
```

---

### Task 7: Frontend Admin Inventory Packaging & Consumables Tab

**Files:**
- Modify: `frontend/src/app/admin/page.tsx` (hoặc component quản lý kho)

**Interfaces:**
- Hiển thị tab lọc "Nguyên liệu pha chế" vs "Bao bì & Vật tư"; hiển thị badge phân biệt "Cốt lõi (Khóa món khi hết)" vs "Phụ trợ (Hết vẫn bán được)".

- [ ] **Step 1: Bổ sung bộ lọc danh mục trong giao diện Tồn Kho**
Trong tab Tồn kho của `/admin`:
- Thêm 3 nút lọc nhanh: "Tất cả", "☕ Nguyên liệu pha chế", "🥤 Bao bì & Dụng cụ".
- Bổ sung cột hoặc badge hiển thị: `Vật tư cốt lõi` (màu xanh/nâu) vs `Vật tư phụ trợ` (màu xám/vàng - không khóa món).

- [ ] **Step 2: Cập nhật Modal Thêm/Sửa Nguyên vật liệu**
Thêm lựa chọn:
- Loại: [Nguyên liệu pha chế / Bao bì & Dụng cụ].
- Checkbox/Switch: "Bắt buộc có mới bán được món (Khóa món khi hết kho)".

- [ ] **Step 3: Kiểm tra build TypeScript**
Run: `npx --prefix frontend tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit inventory packaging UI**
```bash
git add frontend/src/app/admin/page.tsx
git commit -m "feat(admin): add packaging consumables filtering and core vs auxiliary indicators in inventory"
```

---

### Task 8: End-to-End Verification & Manual Smoke Test

**Files:**
- Test all components and flows together.

- [ ] **Step 1: Chạy toàn bộ test backend**
Run: `npm --prefix backend test`
Expected: All tests pass.

- [ ] **Step 2: Chạy kiểm tra linting và type check frontend**
Run: `npx --prefix frontend tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Chạy kịch bản kiểm thử luồng thực tế (Smoke Test)**
1. Khách hàng đổi mật khẩu thành công với xác thực mật khẩu hiện tại.
2. Admin thêm khách hàng mới: điểm hạt vàng khởi tạo là 0, không có ô nhập điểm.
3. Khóa/Mở khóa khách hàng; xóa khách có đơn chuyển thành Tạm khóa bảo toàn đơn hàng.
4. Modal nhân viên không còn trường Vị trí/Chức vụ.
5. Kho bao bì: Khi Ly hết hàng -> Món báo hết hàng; khi Bịch/Muỗng hết hàng -> Món vẫn bán bình thường, kho hiện cảnh báo.

- [ ] **Step 4: Final commit**
```bash
git commit --allow-empty -m "chore: complete customer, packaging consumables and staff cleanup verification"
```
