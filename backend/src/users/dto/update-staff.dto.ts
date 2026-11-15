import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';
import { NoUnsafeHtml } from '../../common/validators/no-unsafe-html.validator.js';

export class UpdateStaffDto {
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  @MaxLength(150, { message: 'Email không được vượt quá 150 ký tự' })
  @IsOptional()
  email?: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  @MaxLength(100, { message: 'Mật khẩu không được vượt quá 100 ký tự' })
  @IsOptional()
  password?: string;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập họ và tên' })
  @Matches(/\S/, { message: 'Họ và tên không được chỉ chứa khoảng trắng' })
  @MaxLength(100, { message: 'Họ và tên không được vượt quá 100 ký tự' })
  @NoUnsafeHtml()
  @IsOptional()
  fullName?: string;

  @IsString()
  @MaxLength(20, { message: 'Số điện thoại không được vượt quá 20 ký tự' })
  @NoUnsafeHtml()
  @IsOptional()
  phone?: string;

  @IsString()
  @MaxLength(100, { message: 'Chức vụ không được vượt quá 100 ký tự' })
  @NoUnsafeHtml()
  @IsOptional()
  position?: string;

  @IsEnum(Role, { message: 'Vai trò người dùng không hợp lệ' })
  @IsOptional()
  role?: Role;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
