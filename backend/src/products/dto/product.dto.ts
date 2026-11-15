import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { NoUnsafeHtml } from '../../common/validators/no-unsafe-html.validator.js';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty({ message: 'Tên món không được để trống' })
  @Matches(/\S/, { message: 'Tên món không được chỉ chứa khoảng trắng' })
  @MaxLength(120, { message: 'Tên món không được vượt quá 120 ký tự' })
  @NoUnsafeHtml()
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Mô tả không được vượt quá 1000 ký tự' })
  @NoUnsafeHtml()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Đường dẫn ảnh không được vượt quá 500 ký tự' })
  @NoUnsafeHtml()
  imageUrl?: string;

  @IsInt({ message: 'Giá bán phải là số nguyên (VNĐ)' })
  @Min(0, { message: 'Giá bán không được âm' })
  @Max(100_000_000, { message: 'Giá bán vượt quá giới hạn cho phép' })
  basePrice: number;

  @IsOptional()
  @IsInt({ message: 'Phụ thu Size M phải là số nguyên (VNĐ)' })
  @Min(0)
  @Max(100_000_000)
  sizeUpchargeM?: number | null;

  @IsOptional()
  @IsInt({ message: 'Phụ thu Size L phải là số nguyên (VNĐ)' })
  @Min(0)
  @Max(100_000_000)
  sizeUpchargeL?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @NoUnsafeHtml()
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @NoUnsafeHtml()
  tag?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isSoldOutManual?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Tên món không được để trống' })
  @Matches(/\S/, { message: 'Tên món không được chỉ chứa khoảng trắng' })
  @MaxLength(120, { message: 'Tên món không được vượt quá 120 ký tự' })
  @NoUnsafeHtml()
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Mô tả không được vượt quá 1000 ký tự' })
  @NoUnsafeHtml()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Đường dẫn ảnh không được vượt quá 500 ký tự' })
  @NoUnsafeHtml()
  imageUrl?: string;

  @IsOptional()
  @IsInt({ message: 'Giá bán phải là số nguyên (VNĐ)' })
  @Min(0, { message: 'Giá bán không được âm' })
  @Max(100_000_000, { message: 'Giá bán vượt quá giới hạn cho phép' })
  basePrice?: number;

  @IsOptional()
  @IsInt({ message: 'Phụ thu Size M phải là số nguyên (VNĐ)' })
  @Min(0)
  @Max(100_000_000)
  sizeUpchargeM?: number | null;

  @IsOptional()
  @IsInt({ message: 'Phụ thu Size L phải là số nguyên (VNĐ)' })
  @Min(0)
  @Max(100_000_000)
  sizeUpchargeL?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @NoUnsafeHtml()
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @NoUnsafeHtml()
  tag?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isSoldOutManual?: boolean;
}

export class ToggleProductVisibilityDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isSoldOutManual?: boolean;
}

export class ToggleSoldOutDto {
  @IsBoolean()
  isSoldOutManual: boolean;
}
