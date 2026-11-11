import { OrderStatus } from '@prisma/client';
import { computeRequiredIngredients } from './bom.helper.js';

export interface RefundOrderOptions {
  performedBy: string;
  notePrefix: string; // note: `${options.notePrefix} #${order.id}`
}

/**
 * Hoàn trả nguyên vật liệu / bao bì (ưu tiên log SALE thực tế, fallback BOM bắt buộc)
 * và hoàn trả voucher cá nhân hoặc lượt dùng mã giảm giá toàn hệ thống.
 */
export async function refundOrderResources(
  tx: any,
  order: {
    id: number;
    userId?: number | null;
    discountCode?: string | null;
    voucherDeducted?: boolean;
    items?: Array<any>;
  },
  options: RefundOrderOptions,
): Promise<{
  refundedIngredientsCount: number;
  refundedVoucher: boolean;
  decrementedDiscountUsage: boolean;
}> {
  let refundedIngredientsCount = 0;
  let refundedVoucher = false;
  let decrementedDiscountUsage = false;

  const refundNote = `${options.notePrefix} #${order.id}`;

  // 1. Hoàn kho nguyên vật liệu & bao bì (ưu tiên log SALE để không hoàn thừa bao bì phụ trợ)
  const saleLogs = tx.inventoryLog?.findMany
    ? await tx.inventoryLog.findMany({
        where: {
          type: 'SALE',
          note: `Xuất bán đơn hàng #${order.id}`,
        },
      })
    : null;

  const refundEntries: Array<{
    ingredientId: number;
    amount: number;
    name?: string;
    unit?: string;
  }> = [];

  if (Array.isArray(saleLogs) && saleLogs.length > 0) {
    for (const log of saleLogs) {
      const amount = Math.abs(Number(log.changeAmount || 0));
      if (amount > 0) {
        refundEntries.push({
          ingredientId: log.ingredientId,
          amount,
          name: log.ingredientName,
          unit: log.unit,
        });
      }
    }
  } else if (
    Array.isArray(order.items) &&
    order.items.length > 0 &&
    tx.recipe &&
    tx.ingredient
  ) {
    const requiredIngredients = await computeRequiredIngredients(tx, order.items);
    for (const reqIng of requiredIngredients) {
      // Khi fallback BOM (không có SALE log), loại bỏ vật tư/bao bì phụ trợ để tránh hoàn thừa
      if (reqIng.requiredAmount > 0 && reqIng.isRequired !== false) {
        refundEntries.push({
          ingredientId: reqIng.ingredientId,
          amount: reqIng.requiredAmount,
          name: reqIng.name,
          unit: reqIng.unit,
        });
      }
    }
  }

  if (refundEntries.length > 0 && tx.ingredient?.update) {
    for (const entry of refundEntries) {
      const updatedIng = await tx.ingredient.update({
        where: { id: entry.ingredientId },
        data: {
          stock: { increment: entry.amount },
          version: { increment: 1 },
        },
      });
      refundedIngredientsCount += 1;

      const newStock = Number(updatedIng?.stock ?? 0);
      const previousStock = Math.max(
        0,
        Number((newStock - entry.amount).toFixed(2)),
      );

      if (tx.inventoryLog?.create) {
        await tx.inventoryLog.create({
          data: {
            ingredientId: entry.ingredientId,
            ingredientName:
              entry.name || updatedIng?.name || 'Nguyên vật liệu',
            unit: entry.unit || updatedIng?.unit || '',
            type: 'CANCEL_REFUND',
            changeAmount: entry.amount,
            previousStock,
            newStock,
            unitCost: 0,
            totalCost: 0,
            note: refundNote,
            performedBy: options.performedBy,
          },
        });
      }
    }
  }

  // 2. Hoàn trả Voucher cá nhân hoặc giảm usageCount của DiscountCode (mutually exclusive)
  if (
    order.userId &&
    order.discountCode &&
    (order as any).voucherDeducted &&
    tx.userVoucher
  ) {
    const resolveVoucherMetadata = async () => {
      let discountPercent = 10;
      let minOrderAmount = 0;
      let maxDiscountAmount: number | null = null;
      if (tx.discountCode?.findUnique) {
        const dbV = await tx.discountCode.findUnique({
          where: { code: order.discountCode },
        });
        if (dbV) {
          discountPercent = dbV.discountPercent ?? 10;
          minOrderAmount = dbV.minOrderAmount ?? 0;
          maxDiscountAmount = dbV.maxDiscountAmount ?? null;
        }
      }
      return { discountPercent, minOrderAmount, maxDiscountAmount };
    };

    if (
      typeof tx.userVoucher.updateMany === 'function' &&
      typeof tx.userVoucher.createMany === 'function'
    ) {
      const incRes = await tx.userVoucher.updateMany({
        where: { userId: order.userId, code: order.discountCode },
        data: { quantity: { increment: 1 } },
      });
      if ((incRes?.count ?? 0) === 0) {
        const meta = await resolveVoucherMetadata();
        const createRes = await tx.userVoucher.createMany({
          data: [
            {
              userId: order.userId,
              code: order.discountCode,
              quantity: 1,
              ...meta,
            },
          ],
          skipDuplicates: true,
        });
        if ((createRes?.count ?? 0) === 0) {
          await tx.userVoucher.updateMany({
            where: { userId: order.userId, code: order.discountCode },
            data: { quantity: { increment: 1 } },
          });
        }
      }
      refundedVoucher = true;
    } else {
      const userVoucher = await tx.userVoucher.findUnique({
        where: {
          userId_code: {
            userId: order.userId,
            code: order.discountCode,
          },
        },
      });
      if (userVoucher) {
        await tx.userVoucher.update({
          where: { id: userVoucher.id },
          data: { quantity: { increment: 1 } },
        });
      } else {
        const meta = await resolveVoucherMetadata();
        const createData = {
          userId: order.userId,
          code: order.discountCode,
          quantity: 1,
          ...meta,
        };
        if (typeof tx.$executeRawUnsafe === 'function') {
          await tx.$executeRawUnsafe('SAVEPOINT sp_voucher');
          try {
            await tx.userVoucher.create({ data: createData });
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT sp_voucher');
          } catch (err: any) {
            if (err?.code === 'P2002') {
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp_voucher');
              const existing = await tx.userVoucher.findUnique({
                where: {
                  userId_code: {
                    userId: order.userId,
                    code: order.discountCode,
                  },
                },
              });
              if (existing) {
                await tx.userVoucher.update({
                  where: { id: existing.id },
                  data: { quantity: { increment: 1 } },
                });
              }
            } else {
              throw err;
            }
          }
        } else {
          await tx.userVoucher.create({ data: createData });
        }
      }
      refundedVoucher = true;
    }
  } else if (
    order.discountCode &&
    !(order as any).voucherDeducted &&
    tx.discountCode?.updateMany
  ) {
    const decRes = await tx.discountCode.updateMany({
      where: { code: order.discountCode, usageCount: { gt: 0 } },
      data: { usageCount: { decrement: 1 } },
    });
    decrementedDiscountUsage = (decRes?.count ?? 1) > 0;
  }

  return {
    refundedIngredientsCount,
    refundedVoucher,
    decrementedDiscountUsage,
  };
}

/**
 * Hủy các đơn hàng PENDING / PAYMENT_FAILED quá hạn 5 phút bằng CAS và hoàn tài nguyên nguyên tử.
 * Có thể giới hạn theo userId hoặc orderId để tránh quét toàn bảng trên các API GET.
 */
export async function expirePendingOrders(
  prisma: any,
  logger?: { log?: (...args: any[]) => void; error?: (...args: any[]) => void },
  scope?: { userId?: number; orderId?: number },
): Promise<number> {
  if (!prisma?.order?.findMany || !prisma?.$transaction) {
    return 0;
  }

  const EXPIRE_TIMEOUT_MS = 5 * 60 * 1000;
  const expiryThreshold = new Date(Date.now() - EXPIRE_TIMEOUT_MS);

  const expiredOrders = await prisma.order.findMany({
    where: {
      ...(scope?.orderId !== undefined ? { id: scope.orderId } : {}),
      ...(scope?.userId !== undefined ? { userId: scope.userId } : {}),
      status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
      createdAt: { lte: expiryThreshold },
    },
    include: { items: true },
  });

  if (!expiredOrders || expiredOrders.length === 0) {
    return 0;
  }

  let cancelledCount = 0;
  for (const order of expiredOrders) {
    try {
      let didCancel = false;
      await prisma.$transaction(async (tx: any) => {
        if (tx.order?.updateMany) {
          const casResult = await tx.order.updateMany({
            where: {
              id: order.id,
              status: order.status,
            },
            data: {
              status: OrderStatus.CANCELLED,
              voucherDeducted: false,
              version: { increment: 1 },
            },
          });
          if (casResult && casResult.count === 0) {
            return;
          }
        } else {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.CANCELLED,
              voucherDeducted: false,
              version: { increment: 1 },
            },
          });
        }
        didCancel = true;

        await refundOrderResources(tx, order, {
          performedBy: 'Hệ thống (Auto-Expire)',
          notePrefix: 'Hoàn kho do tự động hủy đơn quá hạn 5 phút',
        });
      });
      if (didCancel) {
        cancelledCount++;
        logger?.log?.(
          `[Auto-Expire 5m] Đơn hàng #${order.id} (${order.status}) đã tự động hủy do quá 5 phút chưa hoàn tất thanh toán. Đã hoàn trả nguyên liệu vào kho.`,
        );
      }
    } catch (err) {
      logger?.error?.(`Lỗi khi tự động hủy đơn hết hạn #${order.id}:`, err);
    }
  }

  return cancelledCount;
}
