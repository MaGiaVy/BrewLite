import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NoUnsafeHtml } from '../../common/validators/no-unsafe-html.validator.js';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'Họ và tên không được để trống' })
  @MaxLength(100, { message: 'Họ và tên không được vượt quá 100 ký tự' })
  @NoUnsafeHtml()
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Số điện thoại không được vượt quá 20 ký tự' })
  @NoUnsafeHtml()
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Mật khẩu hiện tại không được vượt quá 100 ký tự' })
  currentPassword?: string;

  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'Mật khẩu mới phải có ít nhất 6 ký tự' })
  @Matches(/\S/, { message: 'Mật khẩu mới không được chỉ gồm khoảng trắng' })
  @MaxLength(100, { message: 'Mật khẩu mới không được vượt quá 100 ký tự' })
  newPassword?: string;
}
