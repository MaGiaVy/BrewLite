import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OrderStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { assertTransition } from '../payments/state-machine.helper.js';
import { fetchGlobalSizePricing } from '../inventory/inventory.service.js';

import { computeRequiredIngredients, RequiredIngredientItem } from './bom.helper.js';
import { expirePendingOrders, refundOrderResources } from './order-refund.helper.js';

export type { RequiredIngredientItem };

const POINTS_PER_VND = 1000;

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersService.name);
  private expirationInterval: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Quét và dọn dẹp các đơn PENDING quá hạn 5 phút ngay khi khởi động
    this.cancelExpiredPendingOrders().catch((err) => {
      this.logger.error('Lỗi khi quét đơn hết hạn lúc khởi động:', err);
    });

    // Định kỳ quét mỗi 15 giây để tự động hủy đơn PENDING quá 5 phút và hoàn trả kho
    this.expirationInterval = setInterval(() => {
      this.cancelExpiredPendingOrders().catch((err) => {
        this.logger.error('Lỗi khi quét định kỳ đơn hết hạn:', err);
      });
    }, 15000);
  }

  onModuleDestroy() {
    if (this.expirationInterval) {
      clearInterval(this.expirationInterval);
      this.expirationInterval = null;
    }
  }

  /**
   * Tự động quét và hủy các đơn hàng PENDING & PAYMENT_FAILED đã quá 5 phút (TTL = 5 minutes).
   * Hoàn trả 100% nguyên vật liệu vào kho thông qua Transaction và CAS Guard (INV-01, INV-02).
   */
  async cancelExpiredPendingOrders(): Promise<number> {
    return expirePendingOrders(this.prisma, this.logger);
  }

  private computeRequiredIngredients = computeRequiredIngredients;

  async createOrder(dto: CreateOrderDto, userId: number) {
    // 0. Chống Spam đơn hàng ảo (Cart Hoarding DoS): Giới hạn tối đa 5 đơn PENDING / PAYMENT_FAILED đồng thời cho mỗi user
    if (userId && this.prisma.order?.count) {
      const activePendingCount = await this.prisma.order
        .count({
          where: {
            userId,
            status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
          },
        })
        .catch(() => 0);
      if (activePendingCount >= 5) {
        throw new BadRequestException(
          'Bạn đang có 5 đơn hàng chờ thanh toán. Vui lòng hoàn tất thanh toán hoặc hủy đơn cũ trước khi đặt đơn mới.',
        );
      }
    }

    // 1. Tính rawSubtotal và serverUnitPrice hoàn toàn từ DB
    const productIds = [...new Set(dto.items.map((i) => i.productId))];

    const [products, toppingRecipes, globalSizePricing] = await Promise.all([
      (this.prisma as any).product?.findMany
        ? (this.prisma as any).product.findMany({
            where: { id: { in: productIds } },
          })
        : Promise.resolve([]),
      (this.prisma as any).toppingRecipe?.findMany
        ? (this.prisma as any).toppingRecipe.findMany({
            where: { isActive: true },
          })
        : Promise.resolve([]),
      fetchGlobalSizePricing(this.prisma),
    ]);

    const productMap = new Map<number, any>(
      products.map((p: any) => [p.id, p]),
    );

    let rawSubtotal = 0;
    const itemServerPrices: number[] = [];

    for (const item of dto.items) {
      const matchedProduct = productMap.get(item.productId);
      if (!matchedProduct || matchedProduct.isActive === false) {
        throw new BadRequestException(
          `Sản phẩm #${item.productId} không tồn tại hoặc đã ngừng kinh doanh`,
        );
      }

      if (matchedProduct.isSoldOutManual === true) {
        throw new BadRequestException(
          `Sản phẩm "${matchedProduct.name}" hiện đang tạm ngưng phục vụ (Hết hàng). Vui lòng chọn món khác.`,
        );
      }

      // Bánh ngọt không tính phụ thu size; đồ uống ưu tiên giá riêng trên món rồi mới fallback giá chuẩn StoreSetting
      const normalizedSize = (item.size || 'M').toUpperCase();
      const sizeUpcharge =
        matchedProduct.category === 'bakery'
          ? 0
          : normalizedSize === 'L'
            ? (matchedProduct.sizeUpchargeL ?? globalSizePricing.sizeL)
            : normalizedSize === 'M'
              ? (matchedProduct.sizeUpchargeM ?? globalSizePricing.sizeM)
              : globalSizePricing.sizeS;

      let toppingSum = 0;
      if (Array.isArray(item.toppings) && item.toppings.length > 0) {
        for (const topStr of item.toppings) {
          if (!topStr || !topStr.trim()) continue;
          const lowerTop = topStr.toLowerCase().trim();
          const matchedTopping = toppingRecipes.find(
            (tr: any) =>
              tr.toppingId?.toLowerCase() === lowerTop ||
              tr.toppingName?.toLowerCase() === lowerTop ||
              tr.toppingName?.toLowerCase().includes(lowerTop) ||
              lowerTop.includes(tr.toppingName?.toLowerCase()),
          );
          toppingSum += matchedTopping
            ? Number(matchedTopping.price ?? 8000)
            : 8000;
        }
      }

      const serverUnitPrice =
        Number(matchedProduct.basePrice || 0) + sizeUpcharge + toppingSum;
      itemServerPrices.push(serverUnitPrice);
      rawSubtotal += serverUnitPrice * item.quantity;
    }

    // 2. Transaction: Kiểm tra tồn kho, trừ tồn kho Optimistic Locking, kiểm tra & giữ Voucher, tạo đơn PENDING
    const order = await this.prisma.$transaction(async (tx: any) => {
      // 2.1 Xử lý mã giảm giá bên trong Transaction (Chống Race Condition & Fallback hardcode - Task 2.1 [CRITICAL-02, CRITICAL-03])
      let discountAmount = 0;
      let appliedDiscountCode: string | null = null;
      let voucherDeducted = false;

      if (dto.discountCode && dto.discountCode.trim()) {
        const code = dto.discountCode.trim().toUpperCase();

        // Ưu tiên kiểm tra voucher cá nhân (UserVoucher) trước mã toàn hệ thống (DiscountCode)
        // để tránh DiscountCode trùng mã làm ẩn voucher user đã đổi bằng điểm.
        const userVoucherModel = tx.userVoucher?.findUnique
          ? tx.userVoucher
          : (this.prisma as any).userVoucher;
        const personalVoucher =
          userId && userVoucherModel?.findUnique
            ? await userVoucherModel.findUnique({
                where: {
                  userId_code: {
                    userId,
                    code,
                  },
                },
              })
            : null;

        if (personalVoucher) {
          if (personalVoucher.quantity <= 0) {
            throw new BadRequestException(
              `Bạn đã sử dụng hết mã giảm giá cá nhân "${code}".`,
            );
          }

          const countModel = tx.order?.count ? tx.order : (this.prisma as any).order;
          if (countModel?.count) {
            const pendingWithVoucher = await countModel.count({
              where: {
                userId,
                discountCode: code,
                status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
              },
            });
            if (pendingWithVoucher >= (personalVoucher.quantity || 1)) {
              throw new BadRequestException(
                `Voucher cá nhân "${code}" đang được áp dụng cho một đơn hàng chờ thanh toán khác của bạn.`,
              );
            }
          }

          if (
            personalVoucher.minOrderAmount &&
            rawSubtotal < Number(personalVoucher.minOrderAmount)
          ) {
            throw new BadRequestException(
              `Mã "${code}" yêu cầu đơn hàng tối thiểu ${Number(personalVoucher.minOrderAmount).toLocaleString('vi-VN')}đ.`,
            );
          }

          const rate = Number(personalVoucher.discountPercent || 0) / 100;
          const rawDiscount = Math.round(rawSubtotal * rate);
          const maxCap = personalVoucher.maxDiscountAmount
            ? Number(personalVoucher.maxDiscountAmount)
            : Infinity;
          discountAmount = Math.min(rawDiscount, maxCap);
          appliedDiscountCode = code;

          // Khóa / trừ tạm 1 vé voucher cá nhân ngay bên trong transaction
          const voucherUpdateModel = tx.userVoucher?.update
            ? tx.userVoucher
            : (this.prisma as any).userVoucher;
          if (personalVoucher.quantity > 1) {
            if (voucherUpdateModel?.update) {
              await voucherUpdateModel.update({
                where: { id: personalVoucher.id },
                data: { quantity: { decrement: 1 } },
              });
            }
          } else {
            const voucherDeleteModel = tx.userVoucher?.delete
              ? tx.userVoucher
              : (this.prisma as any).userVoucher;
            if (voucherDeleteModel?.delete) {
              await voucherDeleteModel.delete({
                where: { id: personalVoucher.id },
              });
            }
          }
          voucherDeducted = true;
        } else {
          // Tìm trong mã toàn hệ thống (DiscountCode)
          const discountModel = tx.discountCode?.findUnique
            ? tx.discountCode
            : (this.prisma as any).discountCode;
          const dbVoucher = discountModel?.findUnique
            ? await discountModel.findUnique({ where: { code } })
            : null;

          if (dbVoucher) {
            if (!dbVoucher.isActive) {
              throw new BadRequestException(
                `Mã giảm giá "${code}" hiện đang tạm ngưng áp dụng.`,
              );
            }
            if (
              dbVoucher.minOrderAmount &&
              rawSubtotal < Number(dbVoucher.minOrderAmount)
            ) {
              throw new BadRequestException(
                `Mã "${code}" yêu cầu đơn hàng tối thiểu ${Number(dbVoucher.minOrderAmount).toLocaleString('vi-VN')}đ.`,
              );
            }
            const rate = Number(dbVoucher.discountPercent || 0) / 100;
            const rawDiscount = Math.round(rawSubtotal * rate);
            const maxCap = dbVoucher.maxDiscountAmount
              ? Number(dbVoucher.maxDiscountAmount)
              : Infinity;
            discountAmount = Math.min(rawDiscount, maxCap);
            appliedDiscountCode = code;

            if (tx.discountCode?.update) {
              await tx.discountCode.update({
                where: { id: dbVoucher.id },
                data: { usageCount: { increment: 1 } },
              });
            }
          } else {
            // XÓA BỎ HOÀN TOÀN FALLBACK HARDCODE (Task 2.1 [CRITICAL-02])
            throw new BadRequestException(
              `Mã giảm giá "${dto.discountCode}" không hợp lệ hoặc đã hết hạn.`,
            );
          }
        }
      }

      const afterDiscount = Math.max(0, rawSubtotal - discountAmount);
      const vat = Math.floor(afterDiscount * 0.08);
      // Làm tròn xuống hàng nghìn (ví dụ: 144.720đ -> 144.000đ)
      const totalAmount = Math.floor((afterDiscount + vat) / 1000) * 1000;

      const requiredIngredients = await this.computeRequiredIngredients(
        tx,
        dto.items,
      );

      requiredIngredients.sort((a, b) => a.ingredientId - b.ingredientId);

      const actualDeductedList: Array<{
        ingredientId: number;
        name: string;
        unit: string;
        deductedAmount: number;
        previousStock: number;
        newStock: number;
      }> = [];

      for (const reqIng of requiredIngredients) {
        const currentIng = await tx.ingredient.findUnique({
          where: { id: reqIng.ingredientId },
        });

        if (!currentIng) {
          throw new NotFoundException(
            `Không tìm thấy nguyên vật liệu "${reqIng.name}" trong kho.`,
          );
        }

        const isRequired = currentIng.isRequiredForSale ?? true;

        if (isRequired && currentIng.stock < reqIng.requiredAmount) {
          throw new BadRequestException(
            `Nguyên vật liệu "${currentIng.name}" không đủ tồn kho (Cần ${reqIng.requiredAmount}${currentIng.unit}, hiện còn ${currentIng.stock}${currentIng.unit}).`,
          );
        }

        let deductedAmount = 0;

        if (isRequired) {
          // Optimistic Locking: chỉ trừ kho khi version khớp và stock >= requiredAmount
          const updateRes = await tx.ingredient.updateMany({
            where: {
              id: currentIng.id,
              version: currentIng.version,
              stock: { gte: reqIng.requiredAmount },
            },
            data: {
              stock: { decrement: reqIng.requiredAmount },
              version: { increment: 1 },
            },
          });

          if (updateRes.count === 0) {
            throw new ConflictException(
              `Xung đột đồng thời (Optimistic Lock) khi trừ kho nguyên vật liệu "${currentIng.name}". Vui lòng thử lại.`,
            );
          }
          deductedAmount = reqIng.requiredAmount;
        } else {
          // Phụ trợ (không bắt buộc): trừ tồn kho nếu còn (tối đa về 0), không chặn bán món nếu hết kho
          const deductAmount = Math.min(currentIng.stock, reqIng.requiredAmount);
          if (deductAmount > 0) {
            const packRes = await tx.ingredient.updateMany({
              where: {
                id: currentIng.id,
                version: currentIng.version,
                stock: { gte: deductAmount },
              },
              data: {
                stock: { decrement: deductAmount },
                version: { increment: 1 },
              },
            });
            if ((packRes?.count ?? 1) > 0) {
              deductedAmount = deductAmount;
            }
          }
        }

        if (deductedAmount > 0) {
          const previousStock = Number(currentIng.stock);
          const newStock = Number((previousStock - deductedAmount).toFixed(2));
          actualDeductedList.push({
            ingredientId: reqIng.ingredientId,
            name: reqIng.name || currentIng.name,
            unit: reqIng.unit || currentIng.unit,
            deductedAmount,
            previousStock,
            newStock,
          });
        }
      }

      const newOrder = await tx.order.create({
        data: {
          totalAmount,
          discountCode: appliedDiscountCode,
          discountAmount,
          voucherDeducted,
          userId,
          items: {
            create: dto.items.map((item, idx) => ({
              productId: item.productId,
              productName: productMap.get(item.productId)?.name || '',
              size: item.size,
              sugarLevel: item.sugarLevel ?? '100%',
              iceLevel: item.iceLevel ?? '100%',
              temperature: item.temperature ?? 'COLD',
              notes: item.notes ?? null,
              toppings: item.toppings,
              quantity: item.quantity,
              unitPrice: itemServerPrices[idx],
            })),
          },
        },
        include: { items: true },
      });

      // Task 3.4 [HIGH-11, MEDIUM-13]: Ghi nhận lịch sử xuất kho SALE theo lượng thực tế đã trừ
      if (tx.inventoryLog?.create) {
        for (const entry of actualDeductedList) {
          if (entry.deductedAmount <= 0) continue;
          await tx.inventoryLog.create({
            data: {
              ingredientId: entry.ingredientId,
              ingredientName: entry.name,
              unit: entry.unit,
              type: 'SALE',
              changeAmount: -entry.deductedAmount,
              previousStock: entry.previousStock,
              newStock: entry.newStock,
              unitCost: 0,
              totalCost: 0,
              note: `Xuất bán đơn hàng #${newOrder.id}`,
              performedBy: userId ? `User #${userId}` : 'Khách vãng lai',
            },
          });
        }
      }

      return newOrder;
    });

    return {
      orderId: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
      discountCode: order.discountCode,
      discountAmount: order.discountAmount,
      items: order.items,
    };
  }

  /**
   * Lấy danh sách toàn bộ đơn hàng của user (Task 9 — GET /orders/me)
   */
  async getMyOrders(userId: number) {
    // Chỉ kiểm tra và hủy các đơn quá 5 phút của chính user này
    await expirePendingOrders(this.prisma, this.logger, { userId }).catch(() => 0);

    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: {
        items: true,
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((order) => ({
      id: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      staffId: (order as any).staffId,
      staffName: (order as any).staffName,
      items: order.items,
      payments: order.payments,
    }));
  }

  /**
   * Lấy hàng đợi đơn hàng cho màn hình Barista KDS (/staff)
   * Kèm thông tin định lượng công thức cho từng món để Barista xem nhanh (Quick Recipe Popover)
   */
  async getBaristaQueue() {
    const completedWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [orders, allRecipes, allToppingRecipes] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          OR: [
            {
              status: {
                in: [
                  OrderStatus.PAID,
                  OrderStatus.PREPARING,
                  OrderStatus.READY,
                ],
              },
            },
            {
              status: OrderStatus.COMPLETED,
              updatedAt: { gte: completedWindowStart },
            },
          ],
        },
        include: {
          items: true,
          user: {
            select: { id: true, fullName: true, phone: true },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
      this.prisma.recipe
        ? this.prisma.recipe.findMany({ include: { ingredient: true } })
        : Promise.resolve([]),
      this.prisma.toppingRecipe
        ? this.prisma.toppingRecipe.findMany({ include: { ingredient: true } })
        : Promise.resolve([]),
    ]);

    return orders.map((order) => ({
      ...order,
      items: order.items.map((item) => {
        const normalizedSize = (item.size || 'M').toUpperCase();
        const itemRecipes = allRecipes
          .filter(
            (r: any) =>
              r.productId === item.productId &&
              (r.size === normalizedSize || r.size === 'ALL'),
          )
          .map((r: any) => ({
            ingredientCode: r.ingredient.code,
            ingredientName: r.ingredient.name,
            unit: r.ingredient.unit,
            amountPerUnit: r.amount,
            totalAmount: Number((r.amount * item.quantity).toFixed(2)),
          }));

        const toppingBreakdown: Array<{
          toppingName: string;
          ingredientName: string;
          unit: string;
          totalAmount: number;
        }> = [];

        if (Array.isArray(item.toppings)) {
          for (const topStr of item.toppings) {
            const lowerTop = topStr.toLowerCase();
            const matchedTops = allToppingRecipes.filter(
              (tr: any) =>
                tr.toppingId.toLowerCase() === lowerTop ||
                tr.toppingName.toLowerCase().includes(lowerTop) ||
                lowerTop.includes(tr.toppingName.toLowerCase()),
            );
            for (const tr of matchedTops) {
              toppingBreakdown.push({
                toppingName: tr.toppingName,
                ingredientName: tr.ingredient.name,
                unit: tr.ingredient.unit,
                totalAmount: Number((tr.amount * item.quantity).toFixed(2)),
              });
            }
          }
        }

        return {
          ...item,
          recipeBreakdown: itemRecipes,
          toppingBreakdown,
        };
      }),
    }));
  }

  /**
   * Cập nhật trạng thái đơn hàng (Task 10 & Sprint 4 — PATCH /orders/:id/status)
   * Dùng assertTransition để đảm bảo State Machine Guard.
   * Khi chuyển sang CANCELLED: tự động hoàn kho nguyên vật liệu & thu hồi điểm Loyalty (nếu đơn đã PAID).
   */
  async updateOrderStatus(
    orderId: number,
    nextStatus: OrderStatus,
    userId: number,
    userRole?: Role,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng với mã #${orderId}`);
    }

    const isStaffOrAdmin = userRole === Role.STAFF || userRole === Role.ADMIN;

    if (!isStaffOrAdmin) {
      // Nếu là khách hàng bình thường:
      if (order.userId === null || order.userId !== userId) {
        throw new ForbiddenException('Bạn không có quyền thao tác trên đơn hàng này');
      }
      // Khách hàng CHỈ ĐƯỢC PHÉP hủy đơn hàng của chính mình hoặc thử lại thanh toán (PAYMENT_FAILED -> PENDING):
      const isCustomerCancel = nextStatus === OrderStatus.CANCELLED;
      const isCustomerRetry =
        order.status === OrderStatus.PAYMENT_FAILED &&
        nextStatus === OrderStatus.PENDING;

      if (!isCustomerCancel && !isCustomerRetry) {
        throw new ForbiddenException('Khách hàng không có quyền tự chuyển trạng thái đơn hàng sang trạng thái này');
      }
      // Chỉ được hủy khi đơn đang ở PENDING hoặc PAYMENT_FAILED (INV-02):
      if (
        isCustomerCancel &&
        order.status !== OrderStatus.PENDING &&
        order.status !== OrderStatus.PAYMENT_FAILED
      ) {
        throw new BadRequestException('Chỉ có thể hủy đơn hàng đang ở trạng thái Chờ thanh toán (PENDING) hoặc Thanh toán thất bại (PAYMENT_FAILED)');
      }
    }

    // [HIGH-07] Chặn tuyệt đối nhân viên quầy nhảy cóc sang PAID qua API PATCH
    if (nextStatus === OrderStatus.PAID) {
      throw new BadRequestException(
        'Trạng thái ĐÃ THANH TOÁN (PAID) chỉ được phép cập nhật thông qua Cổng thanh toán hoặc Xác nhận thanh toán hợp lệ.',
      );
    }

    // [BE-M3] Chỉ luồng xử lý thanh toán mới được phép chuyển sang PAYMENT_FAILED
    if (nextStatus === OrderStatus.PAYMENT_FAILED) {
      throw new BadRequestException(
        'Trạng thái THANH TOÁN THẤT BẠI (PAYMENT_FAILED) chỉ được phép cập nhật thông qua luồng xử lý thanh toán.',
      );
    }

    const previousStatus = order.status;

    // State Machine Guard: chặn các transition không hợp lệ
    // Lấy thông tin nhân viên pha chế khi Barista/Admin nhận đơn (PREPARING) hoặc cập nhật đơn
    let staffData: { staffId?: number | null; staffName?: string | null } = {};
    if (isStaffOrAdmin && (nextStatus === OrderStatus.PREPARING || !(order as any).staffId)) {
      try {
        const staffUser = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, fullName: true },
        });
        if (staffUser) {
          staffData = {
            staffId: staffUser.id,
            staffName: staffUser.fullName,
          };
        }
      } catch {
        // bỏ qua nếu lỗi
      }
    }

    assertTransition(previousStatus, nextStatus);

    // Thử lại thanh toán (PAYMENT_FAILED -> PENDING): kiểm tra TTL 5 phút, quá hạn -> CAS cancel + hoàn kho
    if (
      previousStatus === OrderStatus.PAYMENT_FAILED &&
      nextStatus === OrderStatus.PENDING
    ) {
      const EXPIRE_TIMEOUT_MS = 5 * 60 * 1000;
      if (
        order.createdAt &&
        Date.now() - new Date(order.createdAt).getTime() > EXPIRE_TIMEOUT_MS
      ) {
        await this.prisma.$transaction(async (tx: any) => {
          const casResult = await tx.order.updateMany({
            where: {
              id: orderId,
              status: OrderStatus.PAYMENT_FAILED,
            },
            data: {
              status: OrderStatus.CANCELLED,
              voucherDeducted: false,
              version: { increment: 1 },
            },
          });
          if (casResult.count > 0) {
            await refundOrderResources(tx, order, {
              performedBy: userId ? `User #${userId}` : 'Hệ thống (Auto-Expire)',
              notePrefix: 'Hoàn kho do đơn hàng quá hạn 5 phút khi thử lại',
            });
          }
        });
        throw new BadRequestException(
          'Đơn hàng đã quá hạn thanh toán (5 phút) và đã được tự động hủy.',
        );
      }

      const updated = await this.prisma.$transaction(async (tx: any) => {
        const casResult = await tx.order.updateMany({
          where: {
            id: orderId,
            status: OrderStatus.PAYMENT_FAILED,
          },
          data: {
            status: OrderStatus.PENDING,
            version: { increment: 1 },
          },
        });
        if (casResult.count === 0) {
          throw new ConflictException(
            'Trạng thái đơn hàng đã thay đổi hoặc đang được xử lý bởi một tiến trình khác.',
          );
        }

        const updatedRecord = tx.order?.findUnique
          ? await tx.order.findUnique({ where: { id: orderId } })
          : null;

        return (
          updatedRecord || {
            id: orderId,
            status: OrderStatus.PENDING,
            updatedAt: new Date(),
          }
        );
      });

      return {
        orderId: updated.id,
        previousStatus,
        status: updated.status,
        updatedAt: updated.updatedAt,
        staffId: (updated as any).staffId,
        staffName: (updated as any).staffName,
      };
    }

    // Nếu hủy đơn (CANCELLED) -> hoàn kho nguyên vật liệu/bao bì, hoàn voucher/mã giảm giá & thu hồi điểm thưởng (nếu đã PAID)
    if (nextStatus === OrderStatus.CANCELLED && this.prisma.$transaction) {
      const updated = await this.prisma.$transaction(async (tx: any) => {
        // [INV-01] CAS (Compare-And-Swap) Guard: cập nhật trạng thái nguyên tử ngay từ đầu transaction.
        // Chỉ cập nhật nếu trạng thái hiện tại đúng bằng previousStatus.
        // Nếu count === 0 thì đơn hàng đã bị hủy hoặc thay đổi bởi request song song hoặc cron job.
        const casResult = await tx.order.updateMany({
          where: {
            id: orderId,
            status: previousStatus,
          },
          data: {
            status: nextStatus,
            voucherDeducted: false,
            version: { increment: 1 },
            ...staffData,
          },
        });
        if (casResult.count === 0) {
          throw new ConflictException(
            'Trạng thái đơn hàng đã thay đổi hoặc đang được xử lý bởi một tiến trình khác.',
          );
        }

        await refundOrderResources(tx, order, {
          performedBy: userId ? `User #${userId}` : 'Hệ thống',
          notePrefix: 'Hoàn kho do hủy đơn hàng',
        });

        // Nếu hủy từ trạng thái PAID -> thu hồi điểm Loyalty đã cộng bằng CAS atomic
        if (
          previousStatus === OrderStatus.PAID &&
          order.userId &&
          tx.user
        ) {
          const pointsToRevoke = Math.floor(
            order.totalAmount / POINTS_PER_VND,
          );
          if (pointsToRevoke > 0) {
            if (typeof tx.user.updateMany === 'function') {
              const decRes = await tx.user.updateMany({
                where: {
                  id: order.userId,
                  loyaltyPoints: { gte: pointsToRevoke },
                },
                data: {
                  loyaltyPoints: { decrement: pointsToRevoke },
                },
              });
              if ((decRes?.count ?? 0) === 0) {
                await tx.user.updateMany({
                  where: {
                    id: order.userId,
                    loyaltyPoints: { gt: 0, lt: pointsToRevoke },
                  },
                  data: {
                    loyaltyPoints: 0,
                  },
                });
              }
            } else {
              let currentPoints = 0;
              if (typeof tx.user.findUnique === 'function') {
                const currentUser = await tx.user.findUnique({
                  where: { id: order.userId },
                  select: { loyaltyPoints: true },
                });
                currentPoints = currentUser?.loyaltyPoints || 0;
              }
              const newPoints = Math.max(0, currentPoints - pointsToRevoke);
              await tx.user.update({
                where: { id: order.userId },
                data: {
                  loyaltyPoints: newPoints,
                },
              });
            }
          }
        }

        const updatedRecord = tx.order?.findUnique
          ? await tx.order.findUnique({ where: { id: orderId } })
          : null;

        return (
          updatedRecord || {
            id: orderId,
            status: nextStatus,
            ...staffData,
            updatedAt: new Date(),
          }
        );
      });

      return {
        orderId: updated.id,
        previousStatus,
        status: updated.status,
        updatedAt: updated.updatedAt,
        staffId: (updated as any).staffId,
        staffName: (updated as any).staffName,
      };
    }

    // Khi đơn hàng thành công (COMPLETED - Sau khi nhận món):
    if (nextStatus === OrderStatus.COMPLETED && this.prisma.$transaction) {
      const updated = await this.prisma.$transaction(async (tx: any) => {
        const casResult = await tx.order.updateMany({
          where: {
            id: orderId,
            status: previousStatus,
          },
          data: {
            status: nextStatus,
            ...staffData,
            version: { increment: 1 },
          },
        });
        if (casResult.count === 0) {
          throw new ConflictException(
            'Trạng thái đơn hàng đã thay đổi hoặc đang được xử lý bởi một tiến trình khác.',
          );
        }

        const updatedRecord = tx.order?.findUnique
          ? await tx.order.findUnique({ where: { id: orderId } })
          : null;

        return (
          updatedRecord || {
            id: orderId,
            status: nextStatus,
            ...staffData,
            updatedAt: new Date(),
          }
        );
      });

      return {
        orderId: updated.id,
        previousStatus,
        status: updated.status,
        updatedAt: updated.updatedAt,
        staffId: (updated as any).staffId,
        staffName: (updated as any).staffName,
      };
    }

    const casResult = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        status: previousStatus,
      },
      data: {
        status: nextStatus,
        ...staffData,
        version: { increment: 1 },
      },
    });

    if (casResult.count === 0) {
      throw new ConflictException(
        'Trạng thái đơn hàng đã thay đổi hoặc đang được xử lý bởi một tiến trình khác.',
      );
    }

    const updated = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    return {
      orderId: updated?.id ?? orderId,
      previousStatus,
      status: updated?.status ?? nextStatus,
      updatedAt: updated?.updatedAt ?? new Date(),
      staffId: (updated as any)?.staffId ?? staffData.staffId,
      staffName: (updated as any)?.staffName ?? staffData.staffName,
    };
  }

  async getOrderById(orderId: number, userId: number, userRole?: Role) {
    // Chỉ kiểm tra và hủy nếu chính đơn hàng này quá hạn 5 phút
    await expirePendingOrders(this.prisma, this.logger, { orderId }).catch(() => 0);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng với mã #${orderId}`);
    }

    const isStaffOrAdmin =
      userRole === Role.STAFF || userRole === Role.ADMIN;

    if (!isStaffOrAdmin && (order.userId === null || order.userId !== userId)) {
      throw new ForbiddenException('Bạn không có quyền truy cập đơn hàng này');
    }

    const productIds = (order.items || []).map((i) => i.productId);
    let productMap = new Map<number, { imageUrl: string | null }>();
    if (this.prisma.product?.findMany && productIds.length > 0) {
      try {
        const products = await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, imageUrl: true },
        });
        productMap = new Map(products.map((p) => [p.id, p]));
      } catch {
        // fallback if product table not accessible
      }
    }

    return {
      ...order,
      items: order.items.map((item) => ({
        ...item,
        imageUrl: productMap.get(item.productId)?.imageUrl || null,
      })),
    };
  }

  /**
   * Xóa đơn hàng đã hủy hoặc chưa thanh toán (Task xóa đơn)
   * Chỉ cho phép xóa đơn CANCELLED, PAYMENT_FAILED, hoặc PENDING.
   * Nếu đơn PENDING bị xóa, tự động hoàn trả nguyên vật liệu vào kho.
   */
  async deleteOrder(orderId: number, userId: number, userRole?: Role) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng với mã #${orderId}`);
    }

    const isStaffOrAdmin =
      userRole === Role.STAFF || userRole === Role.ADMIN;

    if (!isStaffOrAdmin && (order.userId === null || order.userId !== userId)) {
      throw new ForbiddenException('Bạn không có quyền xóa đơn hàng này');
    }

    // Chỉ cho phép xóa nếu đơn đã CANCELLED hoặc PAYMENT_FAILED hoặc PENDING
    if (
      order.status !== OrderStatus.CANCELLED &&
      order.status !== OrderStatus.PAYMENT_FAILED &&
      order.status !== OrderStatus.PENDING
    ) {
      throw new BadRequestException('Chỉ có thể xóa các đơn hàng đã hủy hoặc chưa thanh toán.');
    }

    // Nếu đơn PENDING hoặc PAYMENT_FAILED bị xóa, CAS chuyển CANCELLED -> hoàn lại nguyên vật liệu & voucher rồi xóa
    if (
      (order.status === OrderStatus.PENDING ||
        order.status === OrderStatus.PAYMENT_FAILED) &&
      this.prisma.$transaction
    ) {
      return await this.prisma.$transaction(async (tx: any) => {
        const casResult = await tx.order.updateMany({
          where: {
            id: orderId,
            status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
          },
          data: {
            status: OrderStatus.CANCELLED,
            voucherDeducted: false,
            version: { increment: 1 },
          },
        });
        if (casResult.count === 0) {
          throw new ConflictException(
            'Trạng thái đơn hàng đã thay đổi hoặc đang được xử lý bởi một tiến trình khác.',
          );
        }

        await refundOrderResources(tx, order, {
          performedBy: userId ? `User #${userId}` : 'Hệ thống',
          notePrefix: 'Hoàn kho do xóa đơn hàng chưa thanh toán',
        });

        await tx.payment.deleteMany({ where: { orderId } });
        await tx.orderItem.deleteMany({ where: { orderId } });
        await tx.order.delete({ where: { id: orderId } });
        return { success: true, message: `Đã xóa đơn hàng #${orderId}` };
      });
    }

    return await this.prisma.$transaction(async (tx: any) => {
      await tx.payment.deleteMany({ where: { orderId } });
      await tx.orderItem.deleteMany({ where: { orderId } });
      const delResult = await tx.order.deleteMany({
        where: { id: orderId, status: OrderStatus.CANCELLED },
      });
      if (delResult.count === 0) {
        throw new ConflictException(
          'Đơn hàng đã bị xóa hoặc trạng thái đã thay đổi bởi một tiến trình khác.',
        );
      }
      return { success: true, message: `Đã xóa đơn hàng #${orderId}` };
    });
  }
}
