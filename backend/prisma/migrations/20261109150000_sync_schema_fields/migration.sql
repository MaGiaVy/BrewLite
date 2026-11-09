-- Đồng bộ các trường CSDL mới nhất cho BrewLite

-- 1. Thêm các cột cho Ingredient (type, isRequiredForSale, version)
ALTER TABLE "Ingredient"
ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'INGREDIENT',
ADD COLUMN IF NOT EXISTS "isRequiredForSale" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

-- 2. Thêm cột mức trần giảm giá cho DiscountCode và UserVoucher
ALTER TABLE "DiscountCode"
ADD COLUMN IF NOT EXISTS "maxDiscountAmount" DOUBLE PRECISION;

ALTER TABLE "UserVoucher"
ADD COLUMN IF NOT EXISTS "maxDiscountAmount" DOUBLE PRECISION;

-- 3. Thêm các cột kiểm soát đơn hàng cho Order
ALTER TABLE "Order"
ADD COLUMN IF NOT EXISTS "voucherDeducted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "staffId" INTEGER,
ADD COLUMN IF NOT EXISTS "staffName" TEXT,
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

-- 4. Thêm các cột tài khoản cho User
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

