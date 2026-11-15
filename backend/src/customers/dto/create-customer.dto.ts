import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NoUnsafeHtml } from '../../common/validators/no-unsafe-html.validator.js';

export class CreateCustomerDto {
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  @IsNotEmpty({ message: 'Vui lòng nhập email' })
  @MaxLength(150, { message: 'Email không được vượt quá 150 ký tự' })
  email: string;

  @IsString({ message: 'Họ và tên phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Vui lòng nhập họ và tên' })
  @Matches(/\S/, { message: 'Họ và tên không được chỉ chứa khoảng trắng' })
  @MaxLength(100, { message: 'Họ và tên không được vượt quá 100 ký tự' })
  @NoUnsafeHtml()
  fullName: string;

  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự' })
  @IsOptional()
  @MaxLength(20, { message: 'Số điện thoại không được vượt quá 20 ký tự' })
  @NoUnsafeHtml()
  phone?: string;

  @IsString({ message: 'Mật khẩu phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Vui lòng nhập mật khẩu (tối thiểu 6 ký tự)' })
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  @MaxLength(100, { message: 'Mật khẩu không được vượt quá 100 ký tự' })
  password: string;
}
