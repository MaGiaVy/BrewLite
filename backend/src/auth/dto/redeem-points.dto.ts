import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RedeemPointsDto {
  @IsInt({ message: 'Số Hạt Vàng cần đổi phải là số nguyên' })
  @Min(1, { message: 'Số Hạt Vàng cần đổi phải lớn hơn hoặc bằng 1' })
  points: number;

  @IsOptional()
  @IsString({ message: 'Mã voucher phải là chuỗi ký tự' })
  @MaxLength(50, { message: 'Mã voucher không được vượt quá 50 ký tự' })
  voucherCode?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi ký tự' })
  @MaxLength(200, { message: 'Mô tả không được vượt quá 200 ký tự' })
  description?: string;
}

