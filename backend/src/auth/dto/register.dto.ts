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

export class RegisterDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @MaxLength(150, { message: 'Email không được vượt quá 150 ký tự' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  @MaxLength(100, { message: 'Mật khẩu không được vượt quá 100 ký tự' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  @Matches(/\S/, { message: 'Họ và tên không được chỉ chứa khoảng trắng' })
  @MaxLength(100, { message: 'Họ và tên không được vượt quá 100 ký tự' })
  @NoUnsafeHtml()
  fullName: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Số điện thoại không được vượt quá 20 ký tự' })
  @NoUnsafeHtml()
  phone?: string;
}
