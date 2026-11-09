import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrderItemDto {
  @IsInt()
  productId: number;

  @IsString()
  productName: string;

  @IsIn(['S', 'M', 'L'])
  size: string;

  @IsArray()
  @ArrayMaxSize(10, { message: 'Mỗi món chỉ được chọn tối đa 10 topping' })
  @IsString({ each: true })
  @MaxLength(50, { each: true, message: 'Tên topping không được vượt quá 50 ký tự' })
  toppings: string[];

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;
}

export class CreateOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsOptional()
  @IsString()
  discountCode?: string;
}
