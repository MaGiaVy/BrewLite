import {
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
import { NoUnsafeHtml } from '../../common/validators/no-unsafe-html.validator.js';

export class RedeemPointsDto {
  @IsInt({ message: 'Số Hạt Vàng cần đổi phải là số nguyên' })
  @Min(1, { message: 'Số Hạt Vàng cần đổi phải lớn hơn hoặc bằng 1' })
  @Max(1_000_000, { message: 'Số Hạt Vàng không hợp lệ' })
  points: number;

  @IsString({ message: 'Mã voucher phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Vui lòng chọn mã voucher cần đổi' })
  @Matches(/\S/, { message: 'Mã voucher không được để trống' })
  @MaxLength(50, { message: 'Mã voucher không được vượt quá 50 ký tự' })
  @NoUnsafeHtml()
  voucherCode: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi ký tự' })
  @MaxLength(200, { message: 'Mô tả không được vượt quá 200 ký tự' })
  @NoUnsafeHtml()
  description?: string;

  // Cho phép payload legacy từ frontend đi qua whitelist; service luôn bỏ qua và dùng giá trị DB/Catalog
  @IsOptional()
  @IsNumber()
  discountPercent?: number;

  @IsOptional()
  @IsNumber()
  minOrderAmount?: number;
}

