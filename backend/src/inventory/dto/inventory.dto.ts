import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class RestockIngredientDto {
  @IsNumber()
  @Min(0.1, { message: 'Số lượng nhập thêm phải lớn hơn 0' })
  @Max(100000000, { message: 'Số lượng nhập thêm không vượt quá 100.000.000' })
  addAmount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000000000, { message: 'Đơn giá không vượt quá 1.000.000.000' })
  unitCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000000000, { message: 'Tổng tiền không vượt quá 10.000.000.000' })
  totalCost?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateIngredientStockDto {
  @IsNumber()
  @Min(0, { message: 'Tồn kho không được âm' })
  @Max(100000000, { message: 'Tồn kho không vượt quá 100.000.000' })
  stock: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000000, { message: 'Ngưỡng cảnh báo không vượt quá 100.000.000' })
  minThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000000000, { message: 'Đơn giá không vượt quá 1.000.000.000' })
  costPerUnit?: number;

  @IsOptional()
  @IsString()
  @IsIn(['INGREDIENT', 'PACKAGING'], {
    message: 'Loại nguyên vật liệu phải là INGREDIENT hoặc PACKAGING',
  })
  type?: string;

  @IsOptional()
  @IsBoolean()
  isRequiredForSale?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateIngredientDto {
  @IsString()
  @IsNotEmpty({ message: 'Mã nguyên vật liệu không được để trống' })
  code: string;

  @IsString()
  @IsNotEmpty({ message: 'Tên nguyên vật liệu không được để trống' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Đơn vị tính không được để trống' })
  unit: string;

  @IsNumber()
  @Min(0, { message: 'Tồn kho ban đầu không được âm' })
  @Max(100000000, { message: 'Tồn kho không vượt quá 100.000.000' })
  stock: number;

  @IsNumber()
  @Min(0, { message: 'Ngưỡng cảnh báo không được âm' })
  @Max(100000000, { message: 'Ngưỡng cảnh báo không vượt quá 100.000.000' })
  minThreshold: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000000000, { message: 'Đơn giá không vượt quá 1.000.000.000' })
  costPerUnit?: number;

  @IsOptional()
  @IsString()
  @IsIn(['INGREDIENT', 'PACKAGING'], {
    message: 'Loại nguyên vật liệu phải là INGREDIENT hoặc PACKAGING',
  })
  type?: string;

  @IsOptional()
  @IsBoolean()
  isRequiredForSale?: boolean;
}

export class UpdateIngredientDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000000, { message: 'Tồn kho không vượt quá 100.000.000' })
  stock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000000, { message: 'Ngưỡng cảnh báo không vượt quá 100.000.000' })
  minThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000000000, { message: 'Đơn giá không vượt quá 1.000.000.000' })
  costPerUnit?: number;

  @IsOptional()
  @IsString()
  @IsIn(['INGREDIENT', 'PACKAGING'], {
    message: 'Loại nguyên vật liệu phải là INGREDIENT hoặc PACKAGING',
  })
  type?: string;

  @IsOptional()
  @IsBoolean()
  isRequiredForSale?: boolean;
}

export class UpsertRecipeDto {
  @IsInt()
  productId: number;

  @IsInt()
  ingredientId: number;

  @IsString()
  @IsNotEmpty()
  @IsIn(['S', 'M', 'L', 'ALL'], {
    message: 'Size công thức chỉ được là S, M, L hoặc ALL',
  })
  size: string;

  @IsNumber()
  @Min(0.01, { message: 'Định lượng tiêu hao phải lớn hơn 0' })
  amount: number;
}

export class UpdateRecipeDto {
  @IsOptional()
  @IsString()
  @IsIn(['S', 'M', 'L', 'ALL'], {
    message: 'Size công thức chỉ được là S, M, L hoặc ALL',
  })
  size?: string;

  @IsNumber()
  @Min(0.01, { message: 'Định lượng tiêu hao phải lớn hơn 0' })
  amount: number;
}

export class CreateToppingRecipeDto {
  @IsString()
  @IsNotEmpty()
  toppingId: string;

  @IsString()
  @IsNotEmpty()
  toppingName: string;

  @IsOptional()
  @IsString()
  subtext?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsInt()
  ingredientId: number;

  @IsNumber()
  @Min(0.01)
  amount: number;
}

export class UpdateToppingRecipeDto {
  @IsOptional()
  @IsString()
  toppingName?: string;

  @IsOptional()
  @IsString()
  subtext?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;
}

export class UpdateSizePricingDto {
  @IsNumber()
  @Min(0)
  sizeS: number;

  @IsNumber()
  @Min(0)
  sizeM: number;

  @IsNumber()
  @Min(0)
  sizeL: number;
}

export class CreateVoucherDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(1)
  @Max(100)
  discountPercent: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateVoucherDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
