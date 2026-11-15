import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NoUnsafeHtml } from '../../common/validators/no-unsafe-html.validator.js';

export class UpdateCustomerDto {
  @IsString({ message: 'Họ và tên phải là chuỗi ký tự' })
  @Matches(/\S/, { message: 'Họ và tên không được để trống' })
  @MaxLength(100, { message: 'Họ và tên không được vượt quá 100 ký tự' })
  @NoUnsafeHtml()
  @IsOptional()
  fullName?: string;

  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự' })
  @MaxLength(20, { message: 'Số điện thoại không được vượt quá 20 ký tự' })
  @NoUnsafeHtml()
  @IsOptional()
  phone?: string;

  @IsString({ message: 'Mật khẩu phải là chuỗi ký tự' })
  @Matches(/\S/, { message: 'Mật khẩu không được chỉ gồm khoảng trắng' })
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  @MaxLength(100, { message: 'Mật khẩu không được vượt quá 100 ký tự' })
  @IsOptional()
  password?: string;

  @IsBoolean({ message: 'Trạng thái hoạt động phải là boolean' })
  @IsOptional()
  isActive?: boolean;
}
