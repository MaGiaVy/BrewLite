
export const DEFAULT_VOUCHER_MAX_DISCOUNTS: Record<string, number> = {
  BREW10: 15000,
  BREWLITE10: 15000,
  BREWCOZY: 25000,
  BREW20: 25000,
  WELCOME20: 25000,
  BREW50: 60000,
};

export function resolveDefaultMaxDiscount(code: string, discountPercent: number): number {
  const upper = (code || '').toUpperCase().trim();
  if (DEFAULT_VOUCHER_MAX_DISCOUNTS[upper]) {
    return DEFAULT_VOUCHER_MAX_DISCOUNTS[upper];
  }
  if (discountPercent <= 10) return 15000;
  if (discountPercent <= 20) return 25000;
  if (discountPercent <= 50) return 60000;
  return 100000;
}
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { expirePendingOrders } from '../orders/order-refund.helper.js';
import {
  CreateIngredientDto,
  CreateToppingRecipeDto,
  CreateVoucherDto,
  RestockIngredientDto,
  UpdateIngredientDto,
  UpdateIngredientStockDto,
  UpdateRecipeDto,
  UpdateSizePricingDto,
  UpdateToppingRecipeDto,
  UpdateVoucherDto,
  UpsertRecipeDto,
} from './dto/inventory.dto.js';

/** Đọc cấu hình phụ thu size chuẩn toàn quán từ StoreSetting với fallback mặc định (S:0, M:5000, L:10000). */
export async function fetchGlobalSizePricing(prisma: any) {
  const pricing = { sizeS: 0, sizeM: 5000, sizeL: 10000 };
  const keyMap: Record<string, keyof typeof pricing> = {
    SIZE_UPCHARGE_S: 'sizeS',
    SIZE_UPCHARGE_M: 'sizeM',
    SIZE_UPCHARGE_L: 'sizeL',
  };

  if (prisma?.storeSetting?.findMany) {
    const settings = await prisma.storeSetting.findMany({
      where: { key: { in: Object.keys(keyMap) } },
    });
    for (const s of settings) {
      const field = keyMap[s.key];
      if (field && s.value !== undefined && s.value !== null && s.value !== '') {
        const parsed = Number(s.value);
        if (!Number.isNaN(parsed)) pricing[field] = parsed;
      }
    }
  }

  return pricing;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  private formatIngredient(ing: any) {
    if (!ing) return ing;
    const stock = Number(ing.stock ?? 0);
    const minThreshold = Number(ing.minThreshold ?? 0);
    const status =
      stock <= 0
        ? 'OUT_OF_STOCK'
        : stock <= minThreshold
          ? 'LOW_STOCK'
          : 'OK';
    const maxRef = Math.max(minThreshold * 8, stock, 1);
    const percentage = Math.min(100, Math.round((stock / maxRef) * 100));
    const costPerUnit = Number(ing.costPerUnit || 0);
    const totalInventoryValue = Math.round(stock * costPerUnit);

    return {
      ...ing,
      stock,
      minThreshold,
      type: ing.type || 'INGREDIENT',
      isRequiredForSale: ing.isRequiredForSale ?? true,
      costPerUnit,
      totalInventoryValue,
      status,
      percentage,
      recipesCount: Array.isArray(ing.recipes) ? ing.recipes.length : 0,
    };
  }

  calculateServings(product: any): {
    availableServings: number;
    isOutOfStock: boolean;
    ingredientOutOfStock: boolean;
  } {
    if (!product) {
      return {
        availableServings: 0,
        isOutOfStock: true,
        ingredientOutOfStock: true,
      };
    }

    const manualSoldOut = Boolean(product.isSoldOutManual);

    if (!Array.isArray(product.recipes) || product.recipes.length === 0) {
      return {
        availableServings: 0,
        isOutOfStock: true,
        ingredientOutOfStock: true,
      };
    }

    const baseRecipes = product.recipes.filter(
      (r: any) => r.size === 'S' || r.size === 'ALL',
    );
    const checkRecipes = baseRecipes.length > 0 ? baseRecipes : product.recipes;

    let minServings = Infinity;
    let ingredientOutOfStock = false;

    for (const r of checkRecipes) {
      const ing = r.ingredient || r;
      const amount = Number(r.amount ?? 1);
      if (ing && amount > 0) {
        // Vật tư phụ trợ (isRequiredForSale = false) không khóa món khi hết hàng
        const isRequired = ing.isRequiredForSale ?? true;
        if (!isRequired) {
          continue;
        }

        const stock = Number(ing.stock ?? 0);
        const possible = Math.floor(stock / amount);
        if (possible < minServings) {
          minServings = possible;
        }
        if (stock < amount) {
          ingredientOutOfStock = true;
        }
      }
    }

    const computedServings =
      minServings === Infinity ? 99 : Math.max(0, minServings);

    return {
      availableServings: manualSoldOut ? 0 : computedServings,
      isOutOfStock: manualSoldOut || ingredientOutOfStock,
      ingredientOutOfStock,
    };
  }

  async getAllIngredients() {
    try {
      const list = await this.prisma.ingredient.findMany({
        include: {
          recipes: {
            select: { id: true, productId: true, size: true },
          },
        },
        orderBy: { id: 'asc' },
      });
      if (Array.isArray(list)) {
        return list.map((ing) => this.formatIngredient(ing));
      }
    } catch (err: any) {
      // Fallback nếu CSDL local chưa chạy migrate mới nhất (thiếu cột type, isRequiredForSale...)
      try {
        if (typeof (this.prisma as any).$queryRaw === 'function') {
          const rawList = await (this.prisma as any).$queryRaw`
            SELECT id, code, name, unit, stock, "minThreshold", "costPerUnit"
            FROM "Ingredient"
            ORDER BY id ASC
          `;
          if (Array.isArray(rawList)) {
            return rawList.map((ing) => this.formatIngredient(ing));
          }
        }
      } catch (rawErr) {
        // Raw query fallback failed
      }
    }
    return [];
  }

  async createIngredient(dto: CreateIngredientDto) {
    const cleanCode = dto.code.trim().toUpperCase().replace(/\s+/g, '_');
    const existing = await this.prisma.ingredient.findUnique({
      where: { code: cleanCode },
    });
    if (existing) {
      throw new ConflictException(
        `Mã nguyên vật liệu "${cleanCode}" đã tồn tại trong kho.`,
      );
    }

    const created = await this.prisma.ingredient.create({
      data: {
        code: cleanCode,
        name: dto.name.trim(),
        unit: dto.unit.trim(),
        stock: dto.stock,
        minThreshold: dto.minThreshold,
        costPerUnit: dto.costPerUnit ?? 0,
        type: dto.type || 'INGREDIENT',
        isRequiredForSale: dto.isRequiredForSale ?? true,
      },
    });
    return this.formatIngredient(created);
  }

  async updateIngredient(id: number, dto: UpdateIngredientDto) {
    const current = await this.prisma.ingredient.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException(`Không tìm thấy nguyên vật liệu #${id}`);
    }

    let cleanCode: string | undefined;
    if (dto.code !== undefined) {
      cleanCode = dto.code.trim().toUpperCase().replace(/\s+/g, '_');
      if (cleanCode !== current.code) {
        const dup = await this.prisma.ingredient.findUnique({
          where: { code: cleanCode },
        });
        if (dup) {
          throw new ConflictException(
            `Mã nguyên vật liệu "${cleanCode}" đã tồn tại.`,
          );
        }
      }
    }

    const updateResult = await this.prisma.ingredient.updateMany({
      where: {
        id,
        version: current.version,
      },
      data: {
        ...(cleanCode !== undefined ? { code: cleanCode } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit.trim() } : {}),
        ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
        ...(dto.minThreshold !== undefined
          ? { minThreshold: dto.minThreshold }
          : {}),
        ...(dto.costPerUnit !== undefined
          ? { costPerUnit: dto.costPerUnit }
          : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.isRequiredForSale !== undefined
          ? { isRequiredForSale: dto.isRequiredForSale }
          : {}),
        version: { increment: 1 },
      },
    });

    if (updateResult.count === 0) {
      throw new ConflictException(
        'Xung đột cập nhật tồn kho (Optimistic Lock Conflict). Dữ liệu vừa bị thay đổi bởi tiến trình khác, vui lòng tải lại.',
      );
    }

    const refreshed = await this.prisma.ingredient.findUnique({ where: { id } });

    return this.formatIngredient(refreshed);
  }

  async deleteIngredient(id: number) {
    const current = await this.prisma.ingredient.findUnique({
      where: { id },
      include: { recipes: true },
    });
    if (!current) {
      throw new NotFoundException(`Không tìm thấy nguyên vật liệu #${id}`);
    }

    const count = await this.prisma.recipe.count({ where: { ingredientId: id } });
    let toppingCount = 0;
    if ((this.prisma as any).toppingRecipe?.count) {
      toppingCount = await (this.prisma as any).toppingRecipe.count({
        where: { ingredientId: id },
      });
    }

    if (count > 0 || toppingCount > 0) {
      throw new ConflictException(
        'Không thể xóa nguyên liệu vì đang được sử dụng trong công thức món. Vui lòng gỡ khỏi công thức trước.',
      );
    }

    await this.prisma.ingredient.delete({ where: { id } });

    return {
      deleted: true,
      id,
      name: current.name,
      removedRecipesCount: 0,
    };
  }

  async restockIngredient(
    id: number,
    dto: RestockIngredientDto,
    performedBy = 'Admin',
  ) {
    const current = await this.prisma.ingredient.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException(`Không tìm thấy nguyên vật liệu #${id}`);
    }

    const effectiveUnitCost =
      dto.unitCost !== undefined
        ? dto.unitCost
        : Number((current as any).costPerUnit || 0);

    const updateData: any = {
      stock: { increment: dto.addAmount },
      version: { increment: 1 },
    };
    if (dto.unitCost !== undefined) {
      updateData.costPerUnit = dto.unitCost;
    }

    const updated = await this.prisma.ingredient.updateMany({
      where: {
        id,
        version: current.version,
      },
      data: updateData,
    });

    if (updated.count === 0) {
      throw new ConflictException(
        'Nguyên vật liệu đang được cập nhật bởi phiên giao dịch khác. Vui lòng thử lại.',
      );
    }

    const refreshed = await this.prisma.ingredient.findUnique({ where: { id } });

    // Ghi nhật ký nhập kho nếu có bảng InventoryLog
    if ((this.prisma as any).inventoryLog?.create) {
      const computedTotalCost =
        dto.totalCost !== undefined
          ? dto.totalCost
          : Math.round(dto.addAmount * effectiveUnitCost);
      await (this.prisma as any).inventoryLog.create({
        data: {
          ingredientId: id,
          ingredientName: current.name,
          unit: current.unit,
          type: 'RESTOCK',
          changeAmount: dto.addAmount,
          previousStock: current.stock,
          newStock: refreshed ? refreshed.stock : current.stock + dto.addAmount,
          unitCost: effectiveUnitCost,
          totalCost: computedTotalCost,
          note: dto.note || 'Nhập kho bổ sung',
          performedBy,
        },
      });
    }

    return this.formatIngredient(refreshed);
  }

  async setIngredientStock(
    id: number,
    dto: UpdateIngredientStockDto,
    performedBy = 'Admin',
  ) {
    const current = await this.prisma.ingredient.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException(`Không tìm thấy nguyên vật liệu #${id}`);
    }

    const updated = await this.prisma.ingredient.updateMany({
      where: {
        id,
        version: current.version,
      },
      data: {
        stock: dto.stock,
        ...(dto.minThreshold !== undefined
          ? { minThreshold: dto.minThreshold }
          : {}),
        ...(dto.costPerUnit !== undefined
          ? { costPerUnit: dto.costPerUnit }
          : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.isRequiredForSale !== undefined
          ? { isRequiredForSale: dto.isRequiredForSale }
          : {}),
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      throw new ConflictException(
        'Nguyên vật liệu đang được cập nhật bởi phiên giao dịch khác. Vui lòng thử lại.',
      );
    }

    const refreshed = await this.prisma.ingredient.findUnique({ where: { id } });

    if ((this.prisma as any).inventoryLog?.create) {
      const diff = Number((dto.stock - current.stock).toFixed(2));
      const unitCost =
        dto.costPerUnit !== undefined
          ? dto.costPerUnit
          : Number((current as any).costPerUnit || 0);
      await (this.prisma as any).inventoryLog.create({
        data: {
          ingredientId: id,
          ingredientName: current.name,
          unit: current.unit,
          type: 'ADJUST',
          changeAmount: diff,
          previousStock: current.stock,
          newStock: dto.stock,
          unitCost,
          totalCost: diff > 0 ? Math.round(diff * unitCost) : 0,
          note: dto.note || 'Kiểm kê điều chỉnh tồn kho thực tế',
          performedBy,
        },
      });
    }

    return this.formatIngredient(refreshed);
  }

  async getInventoryLogs() {
    if (!(this.prisma as any).inventoryLog?.findMany) return [];
    return (this.prisma as any).inventoryLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 80,
    });
  }

  async getRecipeMatrix() {
    const products = await this.prisma.product.findMany({
      include: {
        recipes: {
          include: {
            ingredient: true,
          },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { id: 'asc' },
    });

    const toppingRecipes = await this.prisma.toppingRecipe.findMany({
      include: {
        ingredient: true,
      },
      orderBy: { id: 'asc' },
    });

    return {
      products,
      toppingRecipes,
    };
  }

  async upsertRecipe(dto: UpsertRecipeDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product) {
      throw new NotFoundException(`Không tìm thấy sản phẩm #${dto.productId}`);
    }

    const ingredient = await this.prisma.ingredient.findUnique({
      where: { id: dto.ingredientId },
    });
    if (!ingredient) {
      throw new NotFoundException(
        `Không tìm thấy nguyên vật liệu #${dto.ingredientId}`,
      );
    }

    const normalizedSize = dto.size.trim().toUpperCase();
    return this.prisma.recipe.upsert({
      where: {
        productId_ingredientId_size: {
          productId: dto.productId,
          ingredientId: dto.ingredientId,
          size: normalizedSize,
        },
      },
      update: {
        amount: dto.amount,
      },
      create: {
        productId: dto.productId,
        ingredientId: dto.ingredientId,
        size: normalizedSize,
        amount: dto.amount,
      },
      include: {
        ingredient: true,
      },
    });
  }

  async updateRecipe(id: number, dto: UpdateRecipeDto) {
    const existing = await this.prisma.recipe.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy dòng công thức #${id}`);
    }

    return this.prisma.recipe.update({
      where: { id },
      data: {
        ...(dto.size !== undefined
          ? { size: dto.size.trim().toUpperCase() }
          : {}),
        amount: dto.amount,
      },
      include: {
        ingredient: true,
      },
    });
  }

  async deleteRecipe(id: number) {
    const existing = await this.prisma.recipe.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy dòng công thức #${id}`);
    }

    await this.prisma.recipe.delete({ where: { id } });
    return { deleted: true, id };
  }

  // ─── TOPPING FULL CRUD & PRICING ───────────────────────────────────────────
  async createToppingRecipe(dto: CreateToppingRecipeDto) {
    const cleanId = dto.toppingId.trim().toLowerCase().replace(/\s+/g, '_');
    const ing = await this.prisma.ingredient.findUnique({
      where: { id: dto.ingredientId },
    });
    if (!ing) {
      throw new NotFoundException(
        `Không tìm thấy nguyên vật liệu #${dto.ingredientId}`,
      );
    }

    return this.prisma.toppingRecipe.upsert({
      where: {
        toppingId_ingredientId: {
          toppingId: cleanId,
          ingredientId: dto.ingredientId,
        },
      },
      update: {
        toppingName: dto.toppingName.trim(),
        subtext: dto.subtext?.trim() || 'Topping thơm ngon chuẩn vị',
        price: dto.price,
        isActive: dto.isActive ?? true,
        amount: dto.amount,
      },
      create: {
        toppingId: cleanId,
        toppingName: dto.toppingName.trim(),
        subtext: dto.subtext?.trim() || 'Topping thơm ngon chuẩn vị',
        price: dto.price,
        isActive: dto.isActive ?? true,
        ingredientId: dto.ingredientId,
        amount: dto.amount,
      },
      include: {
        ingredient: true,
      },
    });
  }

  async updateToppingRecipe(id: number, dto: UpdateToppingRecipeDto) {
    const existing = await this.prisma.toppingRecipe.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(
        `Không tìm thấy định lượng Topping #${id}`,
      );
    }

    // Nếu sửa tên, mô tả, giá bán hoặc trạng thái ẩn/hiện của Topping -> cập nhật đồng bộ cho tất cả dòng cùng toppingId
    if (
      dto.toppingName !== undefined ||
      dto.subtext !== undefined ||
      dto.price !== undefined ||
      dto.isActive !== undefined
    ) {
      await (this.prisma.toppingRecipe as any).updateMany({
        where: { toppingId: existing.toppingId },
        data: {
          ...(dto.toppingName !== undefined
            ? { toppingName: dto.toppingName.trim() }
            : {}),
          ...(dto.subtext !== undefined
            ? { subtext: dto.subtext.trim() }
            : {}),
          ...(dto.price !== undefined ? { price: dto.price } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    }

    return this.prisma.toppingRecipe.update({
      where: { id },
      data: {
        ...(dto.toppingName !== undefined
          ? { toppingName: dto.toppingName.trim() }
          : {}),
        ...(dto.subtext !== undefined ? { subtext: dto.subtext.trim() } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      },
      include: {
        ingredient: true,
      },
    });
  }

  async deleteToppingRecipe(id: number) {
    const existing = await this.prisma.toppingRecipe.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy Topping #${id}`);
    }
    await (this.prisma.toppingRecipe as any).delete({ where: { id } });
    return { deleted: true, id, toppingName: existing.toppingName };
  }

  // ─── GLOBAL SIZE PRICING & PUBLIC PRICING CONFIG ──────────────────────────
  async getGlobalSizePricing() {
    return fetchGlobalSizePricing(this.prisma);
  }

  async updateGlobalSizePricing(dto: UpdateSizePricingDto) {
    if ((this.prisma as any).storeSetting?.upsert) {
      await Promise.all([
        (this.prisma as any).storeSetting.upsert({
          where: { key: 'SIZE_UPCHARGE_S' },
          update: { value: String(dto.sizeS) },
          create: {
            key: 'SIZE_UPCHARGE_S',
            value: String(dto.sizeS),
            description: 'Phụ thu Size S chuẩn toàn quán (VNĐ)',
          },
        }),
        (this.prisma as any).storeSetting.upsert({
          where: { key: 'SIZE_UPCHARGE_M' },
          update: { value: String(dto.sizeM) },
          create: {
            key: 'SIZE_UPCHARGE_M',
            value: String(dto.sizeM),
            description: 'Phụ thu Size M chuẩn toàn quán (VNĐ)',
          },
        }),
        (this.prisma as any).storeSetting.upsert({
          where: { key: 'SIZE_UPCHARGE_L' },
          update: { value: String(dto.sizeL) },
          create: {
            key: 'SIZE_UPCHARGE_L',
            value: String(dto.sizeL),
            description: 'Phụ thu Size L chuẩn toàn quán (VNĐ)',
          },
        }),
      ]);
    }
    return this.getGlobalSizePricing();
  }

  async getPublicPricingConfig() {
    const [sizePricing, toppingRows, vouchers] = await Promise.all([
      this.getGlobalSizePricing(),
      this.prisma.toppingRecipe.findMany({
        include: { ingredient: true },
        orderBy: { id: 'asc' },
      }),
      this.getAllVouchers(true),
    ]);

    // Gom nhóm Topping theo toppingId để trả về danh sách Topping duy nhất kèm giá bán, giá vốn & trạng thái tồn kho
    const toppingMap = new Map<
      string,
      {
        id: string;
        name: string;
        subtext: string;
        price: number;
        isActive: boolean;
        isOutOfStock: boolean;
        cogs: number;
      }
    >();

    for (const row of toppingRows as any[]) {
      const existing = toppingMap.get(row.toppingId);
      const rowCost =
        Number(row.amount || 0) * Number(row.ingredient?.costPerUnit || 0);
      const rowOutOfStock =
        row.ingredient && Number(row.ingredient.stock) < Number(row.amount);

      if (!existing) {
        toppingMap.set(row.toppingId, {
          id: row.toppingId,
          name: row.toppingName,
          subtext: row.subtext || 'Topping thơm ngon chuẩn vị',
          price: Number(row.price ?? 8000),
          isActive: row.isActive !== false,
          isOutOfStock: Boolean(rowOutOfStock),
          cogs: Math.round(rowCost),
        });
      } else {
        existing.cogs += Math.round(rowCost);
        if (rowOutOfStock) existing.isOutOfStock = true;
      }
    }

    const allToppingsList = Array.from(toppingMap.values());
    const drinkToppings = allToppingsList.filter(
      (t) => !t.id.startsWith('bakery_') && t.isActive,
    );
    const dbBakeryToppings = allToppingsList.filter(
      (t) => t.id.startsWith('bakery_') && t.isActive,
    );

    const defaultBakeryToppings = [
      {
        id: 'bakery_butter',
        name: 'Bơ lạt Anchor',
        subtext: 'Bơ New Zealand thơm béo ngậy',
        price: 5000,
        isActive: true,
        isOutOfStock: false,
        cogs: 2000,
      },
      {
        id: 'bakery_cream_cheese',
        name: 'Phô mai kem',
        subtext: 'Phô mai tươi chua nhẹ, ngậy béo',
        price: 10000,
        isActive: true,
        isOutOfStock: false,
        cogs: 4000,
      },
      {
        id: 'bakery_jam',
        name: 'Mứt dâu tây',
        subtext: 'Dâu tây Đà Lạt nguyên quả chua ngọt',
        price: 8000,
        isActive: true,
        isOutOfStock: false,
        cogs: 3000,
      },
      {
        id: 'bakery_choco',
        name: 'Xốt sô-cô-la ấm',
        subtext: 'Socola Bỉ đun chảy đậm đà',
        price: 10000,
        isActive: true,
        isOutOfStock: false,
        cogs: 3500,
      },
    ];

    const bakeryToppings =
      dbBakeryToppings.length > 0 ? dbBakeryToppings : defaultBakeryToppings;

    const bakeryServingStyles = [
      {
        id: 'hot',
        name: 'Hâm nóng',
        desc: 'Nướng nóng thơm lừng, xốp giòn chuẩn vị.',
        icon: 'local_fire_department',
      },
      {
        id: 'iced',
        name: 'Dùng ngay',
        desc: 'Bảo quản trong quầy, giữ độ mềm tự nhiên trong nhiệt độ phòng.',
        icon: 'ac_unit',
      },
    ];

    // Bảo mật INV-03: Loại bỏ trường giá vốn cogs khỏi API Public để không rò rỉ bí mật kinh doanh
    const sanitizeTopping = (t: any) => {
      const { cogs, ...publicData } = t;
      return publicData;
    };

    return {
      sizePricing,
      toppings: drinkToppings.map(sanitizeTopping),
      allToppings: allToppingsList.map(sanitizeTopping),
      bakeryToppings: bakeryToppings.map(sanitizeTopping),
      bakeryServingStyles,
      vouchers,
    };
  }

  // ─── VOUCHERS / DISCOUNT CODES CRUD ────────────────────────────────────────
  async getAllVouchers(onlyActive = false) {
    if (!(this.prisma as any).discountCode?.findMany) return [];
    const list = await (this.prisma as any).discountCode.findMany({
      ...(onlyActive ? { where: { isActive: true } } : {}),
      orderBy: { id: 'asc' },
    });

    // Tự động bổ sung mức giảm tối đa cố định chuẩn nếu chưa được cấu hình
    const updated = await Promise.all(
      list.map(async (v: any) => {
        if (
          v.maxDiscountAmount === null ||
          v.maxDiscountAmount === undefined ||
          Number(v.maxDiscountAmount) <= 0
        ) {
          const cap = resolveDefaultMaxDiscount(v.code, Number(v.discountPercent || 0));
          try {
            await (this.prisma as any).discountCode.update({
              where: { id: v.id },
              data: { maxDiscountAmount: cap },
            });
          } catch {
            // bỏ qua nếu lỗi cập nhật bất đồng bộ
          }
          return { ...v, maxDiscountAmount: cap };
        }
        return v;
      }),
    );

    return updated;
  }

  async createVoucher(dto: CreateVoucherDto) {
    const cleanCode = dto.code.trim().toUpperCase().replace(/\s+/g, '');
    const existing = await (this.prisma as any).discountCode.findUnique({
      where: { code: cleanCode },
    });
    if (existing) {
      throw new ConflictException(`Mã giảm giá "${cleanCode}" đã tồn tại.`);
    }

    const defaultCap = resolveDefaultMaxDiscount(
      cleanCode,
      Number(dto.discountPercent || 0),
    );
    const effectiveMaxDiscount =
      dto.maxDiscountAmount !== undefined &&
      dto.maxDiscountAmount !== null &&
      Number(dto.maxDiscountAmount) > 0
        ? Number(dto.maxDiscountAmount)
        : defaultCap;

    return (this.prisma as any).discountCode.create({
      data: {
        code: cleanCode,
        description:
          dto.description?.trim() || `Giảm ${dto.discountPercent}% đơn hàng`,
        discountPercent: dto.discountPercent,
        minOrderAmount: dto.minOrderAmount ?? 0,
        maxDiscountAmount: effectiveMaxDiscount,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateVoucher(id: number, dto: UpdateVoucherDto) {
    const existing = await (this.prisma as any).discountCode.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy mã giảm giá #${id}`);
    }

    let cleanCode: string | undefined;
    if (dto.code !== undefined) {
      cleanCode = dto.code.trim().toUpperCase().replace(/\s+/g, '');
    }

    const defaultCap = resolveDefaultMaxDiscount(
      cleanCode || existing.code,
      Number(dto.discountPercent ?? existing.discountPercent ?? 0),
    );

    let maxDiscountAmountToSave: number | undefined;
    if (dto.maxDiscountAmount !== undefined) {
      maxDiscountAmountToSave =
        dto.maxDiscountAmount !== null && Number(dto.maxDiscountAmount) > 0
          ? Number(dto.maxDiscountAmount)
          : defaultCap;
    }

    return (this.prisma as any).discountCode.update({
      where: { id },
      data: {
        ...(cleanCode !== undefined ? { code: cleanCode } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.discountPercent !== undefined
          ? { discountPercent: dto.discountPercent }
          : {}),
        ...(dto.minOrderAmount !== undefined
          ? { minOrderAmount: dto.minOrderAmount }
          : {}),
        ...(maxDiscountAmountToSave !== undefined
          ? { maxDiscountAmount: maxDiscountAmountToSave }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deleteVoucher(id: number) {
    const existing = await (this.prisma as any).discountCode.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy mã giảm giá #${id}`);
    }
    await (this.prisma as any).discountCode.delete({ where: { id } });
    return { deleted: true, id, code: existing.code };
  }

  async getDashboardStats() {
    await expirePendingOrders(this.prisma, this.logger);

    const [ingredients, orders, sizePricing, vouchers, logs, allRecipes] =
      await Promise.all([
        this.getAllIngredients(),
        this.prisma.order.findMany({
          include: {
            items: true,
            user: {
              select: { id: true, email: true, fullName: true, phone: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        this.getGlobalSizePricing(),
        this.getAllVouchers(false),
        this.getInventoryLogs(),
        (this.prisma as any).recipe?.findMany
          ? (this.prisma as any).recipe.findMany({
              include: { ingredient: true },
            })
          : Promise.resolve([]),
      ]);

    const revenueStatuses: OrderStatus[] = [
      OrderStatus.PAID,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.COMPLETED,
    ];

    const validOrders = orders.filter((o) =>
      revenueStatuses.includes(o.status),
    );

    const totalRevenue = validOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    // Tính tổng Giá vốn hàng bán (Total COGS) từ các đơn hàng thành công
    let totalCogsSold = 0;
    const productStatsMap: Record<
      number,
      {
        productId: number;
        productName: string;
        totalQuantity: number;
        totalRevenue: number;
        totalCogs: number;
        orderCount: number;
      }
    > = {};

    for (const order of validOrders) {
      if (!Array.isArray(order.items)) continue;
      for (const item of order.items) {
        const sz = (item.size || 'M').toUpperCase();
        const itemRecipes = Array.isArray(allRecipes)
          ? allRecipes.filter(
              (r: any) =>
                r.productId === item.productId &&
                (r.size === sz || r.size === 'ALL'),
            )
          : [];
        const unitCogs = itemRecipes.reduce(
          (s: number, r: any) =>
            s + Number(r.amount || 0) * Number(r.ingredient?.costPerUnit || 0),
          0,
        );
        const lineCogs = Math.round(unitCogs * item.quantity);
        totalCogsSold += lineCogs;

        if (!productStatsMap[item.productId]) {
          productStatsMap[item.productId] = {
            productId: item.productId,
            productName: item.productName,
            totalQuantity: 0,
            totalRevenue: 0,
            totalCogs: 0,
            orderCount: 0,
          };
        }
        productStatsMap[item.productId].totalQuantity += item.quantity;
        productStatsMap[item.productId].totalRevenue +=
          item.unitPrice * item.quantity;
        productStatsMap[item.productId].totalCogs += lineCogs;
        productStatsMap[item.productId].orderCount += 1;
      }
    }

    const totalGrossProfit = Math.round(totalRevenue - totalCogsSold);
    const totalInventoryValue = ingredients.reduce(
      (s, i) => s + Number(i.totalInventoryValue || 0),
      0,
    );

    const topSellingProducts = Object.values(productStatsMap)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 8);

    const completedCount = orders.filter(
      (o) => o.status === OrderStatus.COMPLETED,
    ).length;
    const activeCount = orders.filter((o) =>
      [OrderStatus.PAID, OrderStatus.PREPARING, OrderStatus.READY].includes(
        o.status as any,
      ),
    ).length;
    const cancelledCount = orders.filter(
      (o) => o.status === OrderStatus.CANCELLED,
    ).length;

    const lowStockCount = ingredients.filter(
      (i) => i.status === 'LOW_STOCK',
    ).length;
    const outOfStockCount = ingredients.filter(
      (i) => i.status === 'OUT_OF_STOCK',
    ).length;

    return {
      totalIngredients: ingredients.length,
      lowStockCount,
      outOfStockCount,
      totalOrders: orders.length,
      completedCount,
      activeCount,
      cancelledCount,
      totalRevenue,
      totalCogsSold,
      totalGrossProfit,
      totalInventoryValue,
      sizePricing,
      vouchers,
      inventoryLogs: logs,
      topSellingProducts,
      recentOrders: orders.slice(0, 50),
    };
  }
}
