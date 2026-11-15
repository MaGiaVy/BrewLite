import { BadRequestException } from '@nestjs/common';

export interface ToppingGroup {
  toppingId: string;
  toppingName: string;
  price: number;
  isActive: boolean;
  rows: any[];
}

export function groupToppingRecipes(toppingRecipes: any[]): ToppingGroup[] {
  const groups = new Map<string, ToppingGroup>();

  for (const row of toppingRecipes || []) {
    const rawId = typeof row?.toppingId === 'string' ? row.toppingId.trim() : '';
    if (!rawId) continue;

    const key = rawId.toLowerCase();
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        toppingId: rawId,
        toppingName:
          typeof row?.toppingName === 'string' ? row.toppingName.trim() : '',
        price: Number(row?.price ?? 0),
        isActive: row?.isActive !== false,
        rows: [row],
      });
    } else {
      existing.rows.push(row);
      if (row?.isActive === false) {
        existing.isActive = false;
      }
    }
  }

  return Array.from(groups.values());
}

export function findExactToppingGroup(
  toppingRecipes: any[],
  rawTopping: string,
  options: { includeInactive?: boolean } = {},
): ToppingGroup | null {
  if (typeof rawTopping !== 'string') return null;
  const normalized = rawTopping.trim().toLowerCase();
  if (!normalized) return null;

  const groups = groupToppingRecipes(toppingRecipes);
  const candidates = options.includeInactive
    ? groups
    : groups.filter((g) => g.isActive);

  // Ưu tiên khớp chính xác toppingId trước, sau đó mới khớp chính xác toppingName (không dùng includes)
  const byId = candidates.filter(
    (g) => g.toppingId.toLowerCase() === normalized,
  );
  if (byId.length === 1) return byId[0];

  const byName = candidates.filter(
    (g) => g.toppingName.toLowerCase() === normalized,
  );
  if (byName.length === 1) return byName[0];

  return null;
}

export function resolveOrderToppingOrThrow(
  toppingRecipes: any[],
  rawTopping: string,
  context?: { isBakery?: boolean },
): ToppingGroup {
  if (typeof rawTopping !== 'string' || !rawTopping.trim()) {
    throw new BadRequestException('Topping không được để trống hoặc chỉ chứa khoảng trắng.');
  }

  const normalized = rawTopping.trim().toLowerCase();
  const matchedAny = findExactToppingGroup(toppingRecipes, rawTopping, {
    includeInactive: true,
  });

  if (!matchedAny) {
    // Kiểm tra xem có trùng tên giữa nhiều nhóm không
    const groups = groupToppingRecipes(toppingRecipes);
    const ambiguous = groups.filter(
      (g) => g.toppingName.toLowerCase() === normalized,
    );
    if (ambiguous.length > 1) {
      throw new BadRequestException(
        `Topping "${rawTopping.trim()}" bị trùng tên cấu hình. Vui lòng chọn theo mã topping.`,
      );
    }
    throw new BadRequestException(
      `Topping "${rawTopping.trim()}" không tồn tại trong thực đơn.`,
    );
  }

  if (!matchedAny.isActive) {
    throw new BadRequestException(
      `Topping "${matchedAny.toppingName || rawTopping.trim()}" hiện đang tạm ngưng phục vụ.`,
    );
  }

  if (context?.isBakery !== undefined) {
    const isBakeryTopping = matchedAny.toppingId
      .toLowerCase()
      .startsWith('bakery_');
    if (context.isBakery && !isBakeryTopping) {
      throw new BadRequestException(
        `Topping "${matchedAny.toppingName}" chỉ áp dụng cho đồ uống, không áp dụng cho bánh ngọt.`,
      );
    }
    if (!context.isBakery && isBakeryTopping) {
      throw new BadRequestException(
        `Topping "${matchedAny.toppingName}" chỉ áp dụng cho bánh ngọt, không áp dụng cho đồ uống.`,
      );
    }
  }

  return matchedAny;
}
