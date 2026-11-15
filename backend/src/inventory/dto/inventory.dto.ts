import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { INT32_MAX } from '../../common/pipes/parse-int32.pipe.js';
import { NoUnsafeHtml } from '../../common/validators/no-unsafe-html.validator.js';

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
  @MaxLength(300)
  @NoUnsafeHtml()
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
  @MaxLength(300)
  @NoUnsafeHtml()
  note?: string;
}

export class CreateIngredientDto {
  @IsString()
  @IsNotEmpty({ message: 'Mã nguyên vật liệu không được để trống' })
  @Matches(/\S/, { message: 'Mã nguyên vật liệu không hợp lệ' })
  @MaxLength(60)
  @NoUnsafeHtml()
  code: string;

  @IsString()
  @IsNotEmpty({ message: 'Tên nguyên vật liệu không được để trống' })
  @Matches(/\S/, { message: 'Tên nguyên vật liệu không hợp lệ' })
  @MaxLength(120)
  @NoUnsafeHtml()
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Đơn vị tính không được để trống' })
  @Matches(/\S/, { message: 'Đơn vị tính không hợp lệ' })
  @MaxLength(30)
  @NoUnsafeHtml()
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
  @Matches(/\S/)
  @MaxLength(60)
  @NoUnsafeHtml()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(120)
  @NoUnsafeHtml()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(30)
  @NoUnsafeHtml()
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
  @Min(1)
  @Max(INT32_MAX)
  productId: number;

  @IsInt()
  @Min(1)
  @Max(INT32_MAX)
  ingredientId: number;

  @IsString()
  @IsNotEmpty()
  @IsIn(['S', 'M', 'L', 'ALL'], {
    message: 'Size công thức chỉ được là S, M, L hoặc ALL',
  })
  size: string;

  @IsNumber()
  @Min(0.01, { message: 'Định lượng tiêu hao phải lớn hơn 0' })
  @Max(100000, { message: 'Định lượng tiêu hao không vượt quá 100.000' })
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
  @Max(100000, { message: 'Định lượng tiêu hao không vượt quá 100.000' })
  amount: number;
}

export class CreateToppingRecipeDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(60)
  @NoUnsafeHtml()
  toppingId: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  @NoUnsafeHtml()
  toppingName: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @NoUnsafeHtml()
  subtext?: string;

  @IsInt({ message: 'Giá topping phải là số nguyên (VNĐ)' })
  @Min(0)
  @Max(100000000)
  price: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsInt()
  @Min(1)
  @Max(INT32_MAX)
  ingredientId: number;

  @IsNumber()
  @Min(0.01)
  @Max(100000)
  amount: number;
}

export class UpdateToppingRecipeDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  @NoUnsafeHtml()
  toppingName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @NoUnsafeHtml()
  subtext?: string;

  @IsOptional()
  @IsInt({ message: 'Giá topping phải là số nguyên (VNĐ)' })
  @Min(0)
  @Max(100000000)
  price?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100000)
  amount?: number;
}

export class UpdateSizePricingDto {
  @IsInt({ message: 'Phụ thu Size S phải là số nguyên (VNĐ)' })
  @Min(0)
  @Max(100000000)
  sizeS: number;

  @IsInt({ message: 'Phụ thu Size M phải là số nguyên (VNĐ)' })
  @Min(0)
  @Max(100000000)
  sizeM: number;

  @IsInt({ message: 'Phụ thu Size L phải là số nguyên (VNĐ)' })
  @Min(0)
  @Max(100000000)
  sizeL: number;
}

export class CreateVoucherDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(50)
  @NoUnsafeHtml()
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @NoUnsafeHtml()
  description?: string;

  @IsInt({ message: 'Phần trăm giảm giá phải là số nguyên' })
  @Min(1)
  @Max(100)
  discountPercent: number;

  @IsOptional()
  @IsInt({ message: 'Đơn tối thiểu phải là số nguyên (VNĐ)' })
  @Min(0)
  @Max(1000000000)
  minOrderAmount?: number;

  @IsOptional()
  @IsInt({ message: 'Mức giảm tối đa phải là số nguyên (VNĐ)' })
  @Min(0)
  @Max(1000000000)
  maxDiscountAmount?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateVoucherDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(50)
  @NoUnsafeHtml()
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @NoUnsafeHtml()
  description?: string;

  @IsOptional()
  @IsInt({ message: 'Phần trăm giảm giá phải là số nguyên' })
  @Min(1)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsInt({ message: 'Đơn tối thiểu phải là số nguyên (VNĐ)' })
  @Min(0)
  @Max(1000000000)
  minOrderAmount?: number;

  @IsOptional()
  @IsInt({ message: 'Mức giảm tối đa phải là số nguyên (VNĐ)' })
  @Min(0)
  @Max(1000000000)
  maxDiscountAmount?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
