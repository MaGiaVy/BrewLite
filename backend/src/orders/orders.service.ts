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

const POINTS_PER_VND = 1000;

export interface RequiredIngredientItem {
  ingredientId: number;
  code: string;
  name: string;
  unit: string;
  requiredAmount: number;
}

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
    const EXPIRE_TIMEOUT_MS = 5 * 60 * 1000; // 5 phút
    const expiryThreshold = new Date(Date.now() - EXPIRE_TIMEOUT_MS);

    const expiredOrders = await this.prisma.order.findMany({
      where: {
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
        await this.prisma.$transaction(async (tx: any) => {
          // [INV-01 & INV-02] CAS Guard: chỉ cập nhật nếu trạng thái hiện tại vẫn chưa bị thay đổi bởi tiến trình khác
          if (tx.order?.updateMany) {
            const casResult = await tx.order.updateMany({
              where: {
                id: order.id,
                status: order.status,
              },
              data: { status: OrderStatus.CANCELLED },
            });
            if (casResult.count === 0) {
              return;
            }
          } else {
            await tx.order.update({
              where: { id: order.id },
              data: { status: OrderStatus.CANCELLED },
            });
          }

          if (tx.recipe && tx.ingredient && Array.isArray(order.items)) {
            const requiredIngredients = await this.computeRequiredIngredients(
              tx,
              order.items,
            );
            for (const reqIng of requiredIngredients) {
              await tx.ingredient.update({
                where: { id: reqIng.ingredientId },
                data: {
                  stock: { increment: reqIng.requiredAmount },
                  version: { increment: 1 },
                },
              });
            }
          }
        });
        cancelledCount++;
        this.logger.log(
          `[Auto-Expire 5m] Đơn hàng #${order.id} (${order.status}) đã tự động hủy do quá 5 phút chưa hoàn tất thanh toán. Đã hoàn trả nguyên liệu vào kho.`,
        );
      } catch (err) {
        this.logger.error(
          `Lỗi khi tự động hủy đơn hết hạn #${order.id}:`,
          err,
        );
      }
    }

    return cancelledCount;
  }

  /**
   * Tính toán tổng định lượng nguyên vật liệu tiêu hao cho danh sách món + topping
   */
  private async computeRequiredIngredients(
    tx: any,
    items: Array<{
      productId: number;
      size: string;
      toppings: string[];
      quantity: number;
    }>,
  ): Promise<RequiredIngredientItem[]> {
    if (!tx.recipe || !tx.ingredient) {
      return [];
    }

    const productIds = [...new Set(items.map((i) => i.productId))];
    const [recipes, toppingRecipes, products, auxPackaging] = await Promise.all([
      tx.recipe.findMany({
        where: { productId: { in: productIds } },
        include: { ingredient: true },
      }),
      tx.toppingRecipe
        ? tx.toppingRecipe.findMany({
            include: { ingredient: true },
          })
        : Promise.resolve([]),
      tx.product?.findMany
        ? tx.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, category: true },
          })
        : Promise.resolve([]),
      tx.ingredient?.findMany
        ? tx.ingredient.findMany({
            where: {
              code: {
                in: [
                  'PKG_STRAW_BIO',
                  'PKG_STRAW_BOBA',
                  'PKG_BAG_T',
                  'PKG_BAG_2CUP',
                  'PKG_TISSUE',
                  'PKG_SPOON',
                ],
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const productMap = new Map<number, any>(
      (products || []).map((p: any) => [p.id, p]),
    );
    const auxPkgMap = new Map<string, any>(
      (auxPackaging || []).map((ing: any) => [ing.code, ing]),
    );

    const reqMap = new Map<number, RequiredIngredientItem>();

    const addRequirement = (ing: any, amount: number) => {
      if (!ing || amount <= 0) return;
      const existing = reqMap.get(ing.id);
      if (existing) {
        existing.requiredAmount = Number(
          (existing.requiredAmount + amount).toFixed(2),
        );
      } else {
        reqMap.set(ing.id, {
          ingredientId: ing.id,
          code: ing.code,
          name: ing.name,
          unit: ing.unit,
          requiredAmount: Number(amount.toFixed(2)),
        });
      }
    };

    let totalDrinkCups = 0;
    let totalPastries = 0;

    for (const item of items) {
      const normalizedSize = (item.size || 'M').toUpperCase();
      // Lấy công thức theo size hoặc ALL (đối với bánh ngọt)
      const matchedRecipes = recipes.filter(
        (r: any) =>
          r.productId === item.productId &&
          (r.size === normalizedSize || r.size === 'ALL'),
      );

      for (const r of matchedRecipes) {
        addRequirement(r.ingredient, r.amount * item.quantity);
      }

      // Phân loại đồ uống vs bánh ngọt
      const prod = productMap.get(item.productId);
      const isBakery =
        prod?.category === 'bakery' ||
        normalizedSize === 'ALL' ||
        matchedRecipes.some(
          (r: any) =>
            r.ingredient?.code?.startsWith('ING_PAIN') ||
            r.ingredient?.code?.startsWith('ING_CHEESE') ||
            r.ingredient?.code?.startsWith('ING_TIRAMISU'),
        );

      if (isBakery) {
        totalPastries += item.quantity;
      } else {
        totalDrinkCups += item.quantity;
        // Quy tắc ống hút: Topping trân châu/thạch/boba dùng ống hút boba phi 12, còn lại ống hút bio phi 6
        const hasBoba =
          Array.isArray(item.toppings) &&
          item.toppings.some((topStr: string) => {
            const low = topStr.toLowerCase();
            return (
              low.includes('boba') ||
              low.includes('trân châu') ||
              low.includes('thạch')
            );
          });
        const strawCode = hasBoba ? 'PKG_STRAW_BOBA' : 'PKG_STRAW_BIO';
        const strawIng = auxPkgMap.get(strawCode);
        if (strawIng) {
          addRequirement(strawIng, item.quantity);
        }
      }

      // Tính nguyên liệu cho Toppings đi kèm
      if (Array.isArray(item.toppings) && item.toppings.length > 0) {
        for (const topStr of item.toppings) {
          const lowerTop = topStr.toLowerCase();
          const matchedTops = toppingRecipes.filter(
            (tr: any) =>
              tr.toppingId.toLowerCase() === lowerTop ||
              tr.toppingName.toLowerCase().includes(lowerTop) ||
              lowerTop.includes(tr.toppingName.toLowerCase()),
          );
          for (const tr of matchedTops) {
            addRequirement(tr.ingredient, tr.amount * item.quantity);
          }
        }
      }
    }

    // Túi xách và Khăn giấy cho đồ uống
    if (totalDrinkCups > 0) {
      const bag2CupCount = Math.floor(totalDrinkCups / 2);
      const bagTCount = totalDrinkCups % 2;
      const bag2CupIng = auxPkgMap.get('PKG_BAG_2CUP');
      const bagTIng = auxPkgMap.get('PKG_BAG_T');
      const tissueIng = auxPkgMap.get('PKG_TISSUE');

      if (bag2CupIng && bag2CupCount > 0) {
        addRequirement(bag2CupIng, bag2CupCount);
      }
      if (bagTIng && bagTCount > 0) {
        addRequirement(bagTIng, bagTCount);
      }
      if (tissueIng) {
        addRequirement(tissueIng, totalDrinkCups);
      }
    }

    // Muỗng cho bánh ngọt
    if (totalPastries > 0) {
      const spoonIng = auxPkgMap.get('PKG_SPOON');
      if (spoonIng) {
        addRequirement(spoonIng, totalPastries);
      }
    }

    return Array.from(reqMap.values()).sort(
      (a, b) => a.ingredientId - b.ingredientId,
    );
  }

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

    const products = (this.prisma as any).product?.findMany
      ? await (this.prisma as any).product.findMany({
          where: { id: { in: productIds } },
        })
      : [];

    const productMap = new Map<number, any>(
      products.map((p: any) => [p.id, p]),
    );

    const toppingRecipes = (this.prisma as any).toppingRecipe?.findMany
      ? await (this.prisma as any).toppingRecipe.findMany({
          where: { isActive: true },
        })
      : [];

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

      const sizeUpcharge =
        item.size === 'L'
          ? (matchedProduct.sizeUpchargeL ?? 8000)
          : item.size === 'M'
          ? (matchedProduct.sizeUpchargeM ?? 5000)
          : 0;

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

    // 2. Xử lý mã giảm giá (Voucher / Discount Code từ DB + Fallback mặc định)
    let discountAmount = 0;
    let appliedDiscountCode: string | null = null;

    if (dto.discountCode && dto.discountCode.trim()) {
      const code = dto.discountCode.trim().toUpperCase();
      const DISCOUNT_RATES: Record<string, number> = {
        BREW10: 0.1, // Giảm 10% (Tối đa 15.000đ, Đơn tối thiểu 0đ)
        BREWLITE10: 0.1, // Giảm 10%
        BREWCOZY: 0.15, // Giảm 15% (Khách hàng thân thiết)
        BREW20: 0.2, // Giảm 20% (Tối đa 25.000đ, Đơn tối thiểu 60.000đ)
        WELCOME20: 0.2, // Giảm 20%
        BREW50: 0.5, // Giảm 50% (Tối đa 60.000đ, Đơn tối thiểu 120.000đ)
      };

      const MIN_ORDERS: Record<string, number> = {
        BREW10: 0,
        BREWLITE10: 0,
        BREWCOZY: 0,
        BREW20: 60000,
        WELCOME20: 50000,
        BREW50: 120000,
      };

      const MAX_DISCOUNTS: Record<string, number> = {
        BREW10: 15000,
        BREWLITE10: 15000,
        BREWCOZY: 25000,
        BREW20: 25000,
        WELCOME20: 25000,
        BREW50: 60000,
      };

      let matchedRate: number | null = null;
      let minOrderReq = MIN_ORDERS[code] ?? 0;
      let maxDiscountCap = MAX_DISCOUNTS[code] ?? Infinity;

      if ((this.prisma as any).discountCode?.findUnique) {
        const dbVoucher = await (this.prisma as any).discountCode.findUnique({
          where: { code },
        });
        if (dbVoucher) {
          if (!dbVoucher.isActive) {
            throw new BadRequestException(
              `Mã giảm giá "${code}" hiện đang tạm ngưng áp dụng.`,
            );
          }
          if (dbVoucher.minOrderAmount) {
            minOrderReq = Math.max(minOrderReq, Number(dbVoucher.minOrderAmount));
          }
          if (
            dbVoucher.maxDiscountAmount !== null &&
            dbVoucher.maxDiscountAmount !== undefined &&
            Number(dbVoucher.maxDiscountAmount) > 0
          ) {
            maxDiscountCap = Number(dbVoucher.maxDiscountAmount);
          }
          matchedRate = Number(dbVoucher.discountPercent || 0) / 100;
          await (this.prisma as any).discountCode
            .update({
              where: { id: dbVoucher.id },
              data: { usageCount: { increment: 1 } },
            })
            .catch(() => undefined);
        } else if (userId && (this.prisma as any).userVoucher?.findUnique) {
          const personalVoucher = await (this.prisma as any).userVoucher.findUnique({
            where: {
              userId_code: {
                userId,
                code,
              },
            },
          }).catch(() => null);

          if (personalVoucher) {
            // Chống gian lận dùng 1 voucher cho nhiều đơn đồng thời:
            const pendingWithVoucher = await (this.prisma as any).order
              .count({
                where: {
                  userId,
                  discountCode: code,
                  status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
                },
              })
              .catch(() => 0);

            if (pendingWithVoucher >= (personalVoucher.quantity || 1)) {
              throw new BadRequestException(
                `Voucher cá nhân "${code}" đang được áp dụng cho một đơn hàng chờ thanh toán khác của bạn.`,
              );
            }

            if (personalVoucher.minOrderAmount) {
              minOrderReq = Math.max(minOrderReq, Number(personalVoucher.minOrderAmount));
            }
            if (
              personalVoucher.maxDiscountAmount !== null &&
              personalVoucher.maxDiscountAmount !== undefined &&
              Number(personalVoucher.maxDiscountAmount) > 0
            ) {
              maxDiscountCap = Number(personalVoucher.maxDiscountAmount);
            }
            matchedRate = Number(personalVoucher.discountPercent || 0) / 100;
          } else {
            // Chặn dùng chùa Voucher đổi thưởng (như BREW50 -50%) khi tài khoản chưa đổi từ điểm Hạt Vàng
            const LOYALTY_VOUCHERS = [
              'BREW50',
              'BREW20',
              'BREWCOZY',
              'WELCOME20',
              'BREW10',
            ];
            if (LOYALTY_VOUCHERS.includes(code)) {
              throw new BadRequestException(
                `Bạn chưa đổi mã giảm giá "${code}" từ điểm Hạt Vàng hoặc mã đã được sử dụng hết.`,
              );
            }
          }
        }
      }

      if (matchedRate === null && DISCOUNT_RATES[code] !== undefined) {
        matchedRate = DISCOUNT_RATES[code];
      }

      if (matchedRate === null) {
        throw new BadRequestException(
          `Mã giảm giá "${dto.discountCode}" không hợp lệ hoặc đã hết hạn.`,
        );
      }

      if (rawSubtotal < minOrderReq) {
        throw new BadRequestException(
          `Mã "${code}" yêu cầu đơn hàng tối thiểu ${minOrderReq.toLocaleString('vi-VN')}đ.`,
        );
      }

      const rawDiscount = Math.round(rawSubtotal * matchedRate);
      discountAmount = Math.min(rawDiscount, maxDiscountCap);
      appliedDiscountCode = code;
    }

    const afterDiscount = Math.max(0, rawSubtotal - discountAmount);
    const vat = Math.floor(afterDiscount * 0.08);
    // Làm tròn xuống hàng nghìn (ví dụ: 144.720đ -> 144.000đ)
    const totalAmount = Math.floor((afterDiscount + vat) / 1000) * 1000;

    // 3. Transaction: Trừ tồn kho nguyên vật liệu bằng Optimistic Locking + Tạo đơn PENDING
    const order = await this.prisma.$transaction(async (tx) => {
      const requiredIngredients = await this.computeRequiredIngredients(
        tx,
        dto.items,
      );

      requiredIngredients.sort((a, b) => a.ingredientId - b.ingredientId);

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
        } else {
          // Phụ trợ (không bắt buộc): trừ tồn kho nếu còn (tối đa về 0), không chặn bán món nếu hết kho
          const deductAmount = Math.min(currentIng.stock, reqIng.requiredAmount);
          if (deductAmount > 0) {
            await tx.ingredient.updateMany({
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
          }
        }

      }

      const newOrder = await tx.order.create({
        data: {
          totalAmount,
          discountCode: appliedDiscountCode,
          discountAmount,
          userId,
          items: {
            create: dto.items.map((item, idx) => ({
              productId: item.productId,
              productName:
                item.productName || productMap.get(item.productId)?.name || '',
              size: item.size,
              toppings: item.toppings,
              quantity: item.quantity,
              unitPrice: itemServerPrices[idx],
            })),
          },
        },
        include: { items: true },
      });

      // Lưu ý: Không trừ số lượng voucher tại thời điểm tạo đơn.
      // Mã chỉ bị trừ khi đơn hàng thành công (sau khi nhận món: OrderStatus.COMPLETED).
      // Nếu có bất kỳ yếu tố gì khiến đơn hàng failed (hủy đơn, thanh toán lỗi...), mã vẫn được bảo toàn nguyên vẹn.

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
    // Tự động kiểm tra và hủy các đơn quá 5 phút trước khi trả về danh sách
    await this.cancelExpiredPendingOrders().catch(() => {});

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
    const [orders, allRecipes, allToppingRecipes] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          status: {
            in: [
              OrderStatus.PAID,
              OrderStatus.PREPARING,
              OrderStatus.READY,
              OrderStatus.COMPLETED,
            ],
          },
        },
        include: {
          items: true,
          user: {
            select: { id: true, email: true, fullName: true, phone: true },
          },
        },
        orderBy: { createdAt: 'asc' },
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
      // Khách hàng CHỈ ĐƯỢC PHÉP hủy đơn hàng của chính mình (chuyển sang CANCELLED):
      if (nextStatus !== OrderStatus.CANCELLED) {
        throw new ForbiddenException('Khách hàng không có quyền tự chuyển trạng thái đơn hàng sang trạng thái này');
      }
      // Chỉ được hủy khi đơn đang ở PENDING hoặc PAYMENT_FAILED (INV-02):
      if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.PAYMENT_FAILED) {
        throw new BadRequestException('Chỉ có thể hủy đơn hàng đang ở trạng thái Chờ thanh toán (PENDING) hoặc Thanh toán thất bại (PAYMENT_FAILED)');
      }
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

    // Nếu hủy đơn (CANCELLED) và có $transaction + recipe -> hoàn lại kho nguyên vật liệu & trừ lại điểm thưởng
    if (nextStatus === OrderStatus.CANCELLED && this.prisma.$transaction) {
      const updated = await this.prisma.$transaction(async (tx: any) => {
        // [INV-01] CAS (Compare-And-Swap) Guard: cập nhật trạng thái nguyên tử ngay từ đầu transaction.
        // Chỉ cập nhật nếu trạng thái hiện tại đúng bằng previousStatus.
        // Nếu count === 0 thì đơn hàng đã bị hủy hoặc thay đổi bởi request song song hoặc cron job.
        if (tx.order?.updateMany) {
          const casResult = await tx.order.updateMany({
            where: {
              id: orderId,
              status: previousStatus,
            },
            data: {
              status: nextStatus,
              voucherDeducted: false,
              ...staffData,
            },
          });
          if (casResult.count === 0) {
            throw new ConflictException(
              'Trạng thái đơn hàng đã thay đổi hoặc đang được xử lý bởi một tiến trình khác.',
            );
          }
        }

        if (tx.recipe && tx.ingredient && Array.isArray(order.items)) {
          const requiredIngredients = await this.computeRequiredIngredients(
            tx,
            order.items,
          );
          for (const reqIng of requiredIngredients) {
            await tx.ingredient.update({
              where: { id: reqIng.ingredientId },
              data: {
                stock: { increment: reqIng.requiredAmount },
                version: { increment: 1 },
              },
            });
          }
        }

        // Nếu hủy từ trạng thái PAID -> thu hồi điểm Loyalty đã cộng
        if (
          previousStatus === OrderStatus.PAID &&
          order.userId &&
          tx.user
        ) {
          const pointsToRevoke = Math.floor(
            order.totalAmount / POINTS_PER_VND,
          );
          if (pointsToRevoke > 0) {
            await tx.user.update({
              where: { id: order.userId },
              data: {
                loyaltyPoints: { decrement: pointsToRevoke },
              },
            });
          }
        }

        // Nếu đơn hàng đã từng bị trừ mã voucher (voucherDeducted === true) -> trả lại mã cho khách
        if (
          order.userId &&
          order.discountCode &&
          (order as any).voucherDeducted &&
          tx.userVoucher
        ) {
          try {
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
              await tx.userVoucher.create({
                data: {
                  userId: order.userId,
                  code: order.discountCode,
                  quantity: 1,
                  discountPercent: 10,
                  minOrderAmount: 0,
                },
              });
            }
          } catch {
            // Bỏ qua lỗi
          }
        }

        let updatedRecord: any = null;
        if (tx.order?.findUnique) {
          updatedRecord = await tx.order.findUnique({ where: { id: orderId } });
        }
        if (!updatedRecord && tx.order?.update) {
          updatedRecord = await tx.order.update({
            where: { id: orderId },
            data: { status: nextStatus, voucherDeducted: false, ...staffData },
          });
        }

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
    // Trừ 1 vé voucher cá nhân của người dùng nếu có áp dụng mã và chưa từng trừ
    if (nextStatus === OrderStatus.COMPLETED && this.prisma.$transaction) {
      const updated = await this.prisma.$transaction(async (tx: any) => {
        if (order.userId && order.discountCode && !(order as any).voucherDeducted) {
          try {
            if (tx.userVoucher) {
              const userVoucher = await tx.userVoucher.findUnique({
                where: {
                  userId_code: {
                    userId: order.userId,
                    code: order.discountCode,
                  },
                },
              });
              if (userVoucher) {
                if (userVoucher.quantity > 1) {
                  await tx.userVoucher.update({
                    where: { id: userVoucher.id },
                    data: { quantity: { decrement: 1 } },
                  });
                } else {
                  await tx.userVoucher.delete({
                    where: { id: userVoucher.id },
                  });
                }
              }
            }
          } catch {
            // Bỏ qua lỗi nếu bảng userVoucher chưa sẵn sàng
          }
        }

        return tx.order.update({
          where: { id: orderId },
          data: {
            status: nextStatus,
            voucherDeducted: order.discountCode ? true : false,
          },
        });
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

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: nextStatus,
        ...staffData,
      },
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

  async getOrderById(orderId: number, userId: number, userRole?: Role) {
    // Tự động kiểm tra và hủy các đơn quá 5 phút trước khi trả về chi tiết đơn
    await this.cancelExpiredPendingOrders().catch(() => {});

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

    // Nếu đơn PENDING hoặc PAYMENT_FAILED bị xóa, hoàn lại nguyên vật liệu
    if (
      (order.status === OrderStatus.PENDING ||
        order.status === OrderStatus.PAYMENT_FAILED) &&
      this.prisma.$transaction
    ) {
      return await this.prisma.$transaction(async (tx: any) => {
        if (tx.recipe && tx.ingredient && Array.isArray(order.items)) {
          const requiredIngredients = await this.computeRequiredIngredients(
            tx,
            order.items,
          );
          for (const reqIng of requiredIngredients) {
            await tx.ingredient.update({
              where: { id: reqIng.ingredientId },
              data: {
                stock: { increment: reqIng.requiredAmount },
                version: { increment: 1 },
              },
            });
          }
        }
        await tx.payment.deleteMany({ where: { orderId } });
        await tx.orderItem.deleteMany({ where: { orderId } });
        await tx.order.delete({ where: { id: orderId } });
        return { success: true, message: `Đã xóa đơn hàng #${orderId}` };
      });
    }

    return await this.prisma.$transaction(async (tx: any) => {
      await tx.payment.deleteMany({ where: { orderId } });
      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.order.delete({ where: { id: orderId } });
      return { success: true, message: `Đã xóa đơn hàng #${orderId}` };
    });
  }
}
