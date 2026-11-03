import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateCustomerDto {
  @IsString({ message: 'Họ và tên phải là chuỗi ký tự' })
  @IsOptional()
  fullName?: string;

  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự' })
  @IsOptional()
  phone?: string;

  @IsString({ message: 'Mật khẩu phải là chuỗi ký tự' })
  @IsOptional()
  password?: string;

  @IsBoolean({ message: 'Trạng thái hoạt động phải là boolean' })
  @IsOptional()
  isActive?: boolean;
}
