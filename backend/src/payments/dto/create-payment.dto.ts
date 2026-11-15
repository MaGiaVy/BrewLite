import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { INT32_MAX } from '../../common/pipes/parse-int32.pipe.js';

export class CreatePaymentDto {
  @IsInt({ message: 'Mã đơn hàng orderId phải là số nguyên' })
  @Min(1, { message: 'Mã đơn hàng orderId phải lớn hơn hoặc bằng 1' })
  @Max(INT32_MAX, { message: `Mã đơn hàng orderId không vượt quá ${INT32_MAX}` })
  orderId: number;

  @IsEnum(PaymentMethod, {
    message: 'Phương thức thanh toán phải là EWALLET hoặc BANK_CARD',
  })
  method: PaymentMethod;

  @IsOptional()
  @IsBoolean({ message: 'simulateFailure phải là giá trị boolean (true/false)' })
  simulateFailure?: boolean;
}
