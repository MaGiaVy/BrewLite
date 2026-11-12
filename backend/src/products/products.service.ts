import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateProductDto,
  ToggleProductVisibilityDto,
  ToggleSoldOutDto,
  UpdateProductDto,
} from './dto/product.dto.js';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private enrichProductStock(
    product: any,
    orderCountMap?: Record<number, number>,
    isAdmin = false,
  ) {
    if (!product) return product;

    const manualSoldOut = Boolean(product.isSoldOutManual);
    const basePrice = Number(product.basePrice || 0);

    if (!Array.isArray(product.recipes) || product.recipes.length === 0) {
      if (!isAdmin) {
        return {
          id: product.id,
          name: product.name,
          basePrice,
          sizeUpchargeM: product.sizeUpchargeM ?? null,
          sizeUpchargeL: product.sizeUpchargeL ?? null,
          imageUrl: product.imageUrl ?? null,
          description: product.description ?? null,
          isOutOfStock: true,
          outOfStockSizes: ['S', 'M', 'L'],
          availableServings: 0,
          category: product.category,
        };
      }
      return {
        ...product,
        isOutOfStock: true, // Tự động khóa đặt món nếu chưa có công thức BOM
        ingredientOutOfStock: true,
        availableServings: 0,
        recipesCount: 0,
        orderItemsCount: orderCountMap
          ? (orderCountMap[product.id] ?? 0)
          : undefined,
        cogsSizeS: 0,
        cogsSizeM: 0,
        cogsSizeL: 0,
        grossProfitS: basePrice,
        marginPercentS: 100,
      };
    }

    const sizes = ['S', 'M', 'L'];
    const outOfStockSizes: string[] = [];
    const hasBeverageSizes = product.recipes.some((r: any) =>
      ['S', 'M', 'L'].includes(r.size),
    );

    if (hasBeverageSizes) {
      for (const size of sizes) {
        const sizeRecipes = product.recipes.filter(
          (r: any) => (r.size === size || r.size === 'ALL') && r.amount > 0,
        );
        if (sizeRecipes.length === 0) continue;

        const isSizeOut = sizeRecipes.some((r: any) => {
          const isRequired = r.ingredient?.isRequiredForSale ?? true;
          if (!isRequired) return false;
          return (r.ingredient?.stock ?? 0) < r.amount;
        });

        if (isSizeOut) {
          outOfStockSizes.push(size);
        }
      }
    }

    let minServings = Infinity;
    let ingredientOutOfStock = false;

    if (hasBeverageSizes) {
      const activeSizes = sizes.filter((s) =>
        product.recipes.some((r: any) => r.size === s),
      );
      // Món chỉ coi là hết hàng hoàn toàn khi TẤT CẢ các size đều đã hết hàng
      ingredientOutOfStock =
        activeSizes.length > 0 &&
        activeSizes.every((s) => outOfStockSizes.includes(s));

      if (ingredientOutOfStock) {
        minServings = 0;
      } else {
        for (const r of product.recipes) {
          if (r.ingredient && r.amount > 0) {
            const isRequired = r.ingredient.isRequiredForSale ?? true;
            if (!isRequired) continue;
            // Bỏ qua nguyên liệu/bao bì thuộc size đã hết hàng, tránh kéo minServings của cả món về 0 (Task 3.5 [MEDIUM-14])
            if (r.size && r.size !== 'ALL' && outOfStockSizes.includes(r.size)) {
              continue;
            }
            const possible = Math.floor(r.ingredient.stock / r.amount);
            if (possible < minServings) {
              minServings = possible;
            }
          }
        }
      }
    } else {
      // Món không có size (bánh ngọt)
      for (const r of product.recipes) {
        if (r.ingredient && r.amount > 0) {
          const isRequired = r.ingredient.isRequiredForSale ?? true;
          if (!isRequired) continue;
          const possible = Math.floor(r.ingredient.stock / r.amount);
          if (possible < minServings) {
            minServings = possible;
          }
          if (r.ingredient.stock < r.amount) {
            ingredientOutOfStock = true;
          }
        }
      }
      if (ingredientOutOfStock) {
        outOfStockSizes.push('ALL');
      }
    }

    const computedServings =
      minServings === Infinity ? 99 : Math.max(0, minServings);

    if (!isAdmin) {
      return {
        id: product.id,
        name: product.name,
        basePrice,
        sizeUpchargeM: product.sizeUpchargeM ?? null,
        sizeUpchargeL: product.sizeUpchargeL ?? null,
        imageUrl: product.imageUrl ?? null,
        description: product.description ?? null,
        isOutOfStock: manualSoldOut || ingredientOutOfStock,
        isSoldOutManual: manualSoldOut,
        outOfStockSizes,
        availableServings: manualSoldOut ? 0 : computedServings,
        category: product.category,
      };
    }

    // Tính Giá vốn (COGS) theo từng Size (S, M, L) dựa trên Recipe.amount * Ingredient.costPerUnit
    const calcCogsForSize = (targetSize: string) => {
      const sizeRecs = product.recipes.filter(
        (r: any) => r.size === targetSize || r.size === 'ALL',
      );
      return Math.round(
        sizeRecs.reduce((sum: number, r: any) => {
          const unitCost = Number(r.ingredient?.costPerUnit || 0);
          return sum + Number(r.amount || 0) * unitCost;
        }, 0),
      );
    };

    const cogsSizeS = calcCogsForSize('S');
    const cogsSizeM = calcCogsForSize('M') || cogsSizeS;
    const cogsSizeL = calcCogsForSize('L') || cogsSizeM;
    const grossProfitS = Math.round(basePrice - cogsSizeS);
    const marginPercentS =
      basePrice > 0
        ? Math.max(0, Math.round((grossProfitS / basePrice) * 100))
        : 0;

    return {
      ...product,
      isOutOfStock: manualSoldOut || ingredientOutOfStock,
      ingredientOutOfStock,
      outOfStockSizes,
      availableServings: manualSoldOut ? 0 : computedServings,
      recipesCount: product.recipes.length,
      orderItemsCount: orderCountMap
        ? (orderCountMap[product.id] ?? 0)
        : undefined,
      cogsSizeS,
      cogsSizeM,
      cogsSizeL,
      grossProfitS,
      marginPercentS,
    };
  }

  async findAll(includeInactive = false, isAdmin: boolean = includeInactive) {
    const products = await this.prisma.product.findMany({
      ...(includeInactive ? {} : { where: { isActive: true } }),
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

    if (!Array.isArray(products)) return products;

    let orderCountMap: Record<number, number> | undefined;
    if (includeInactive && (this.prisma as any).orderItem?.findMany) {
      const orderItems = await this.prisma.orderItem.findMany({
        select: { productId: true, quantity: true },
      });
      orderCountMap = {};
      for (const item of orderItems) {
        orderCountMap[item.productId] =
          (orderCountMap[item.productId] ?? 0) + (item.quantity ?? 1);
      }
    }

    return products.map((p) => this.enrichProductStock(p, orderCountMap, isAdmin));
  }

  async findOne(id: number, isAdmin = false) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        recipes: {
          include: {
            ingredient: true,
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!product) {
      throw new NotFoundException(`Product #${id} not found`);
    }
    return this.enrichProductStock(product, undefined, isAdmin);
  }

  async create(dto: CreateProductDto) {
    const created = await this.prisma.product.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        imageUrl: dto.imageUrl?.trim() || '/images/products/ca-phe-sua.png',
        basePrice: dto.basePrice,
        sizeUpchargeM:
          dto.sizeUpchargeM !== undefined ? dto.sizeUpchargeM : null,
        sizeUpchargeL:
          dto.sizeUpchargeL !== undefined ? dto.sizeUpchargeL : null,
        category: dto.category || 'vietnamese',
        tag: dto.tag?.trim() || 'Phổ biến',
        isActive: dto.isActive ?? true,
        isSoldOutManual: dto.isSoldOutManual ?? false,
      },
      include: {
        recipes: {
          include: { ingredient: true },
        },
      },
    });
    return this.enrichProductStock(created, undefined, true);
  }

  async update(id: number, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy sản phẩm #${id}`);
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() || null }
          : {}),
        ...(dto.imageUrl !== undefined
          ? { imageUrl: dto.imageUrl.trim() || null }
          : {}),
        ...(dto.basePrice !== undefined ? { basePrice: dto.basePrice } : {}),
        ...(dto.sizeUpchargeM !== undefined
          ? { sizeUpchargeM: dto.sizeUpchargeM }
          : {}),
        ...(dto.sizeUpchargeL !== undefined
          ? { sizeUpchargeL: dto.sizeUpchargeL }
          : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.tag !== undefined ? { tag: dto.tag.trim() || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.isSoldOutManual !== undefined
          ? { isSoldOutManual: dto.isSoldOutManual }
          : {}),
      },
      include: {
        recipes: {
          include: { ingredient: true },
        },
      },
    });

    return this.enrichProductStock(updated, undefined, true);
  }

  async toggleVisibility(id: number, dto: ToggleProductVisibilityDto) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy sản phẩm #${id}`);
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.isSoldOutManual !== undefined
          ? { isSoldOutManual: dto.isSoldOutManual }
          : {}),
      },
      include: {
        recipes: {
          include: { ingredient: true },
        },
      },
    });

    return this.enrichProductStock(updated, undefined, true);
  }

  async toggleSoldOut(id: number, dto: ToggleSoldOutDto, isAdmin = false) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy sản phẩm #${id}`);
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        isSoldOutManual: dto.isSoldOutManual,
      },
      include: {
        recipes: {
          include: { ingredient: true },
        },
      },
    });

    return {
      ...this.enrichProductStock(updated, undefined, isAdmin),
      isSoldOutManual: updated.isSoldOutManual,
    };
  }

  async remove(id: number) {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      include: { recipes: true },
    });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy sản phẩm #${id}`);
    }

    await this.prisma.product.delete({ where: { id } });

    return {
      deleted: true,
      id,
      name: existing.name,
      removedRecipesCount: existing.recipes?.length ?? 0,
    };
  }
}
