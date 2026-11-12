-- Add idempotency columns and composite unique index on Order (parity with As2)
ALTER TABLE "Order"
ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
ADD COLUMN IF NOT EXISTS "idempotencyPayload" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_userId_idempotencyKey_key" ON "Order"("userId", "idempotencyKey");
