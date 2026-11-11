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
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrderItemDto {
  @IsInt()
  @Min(1)
  productId: number;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsIn(['S', 'M', 'L', 'ALL'])
  size: string;

  @IsOptional()
  @IsString()
  sugarLevel?: string;

  @IsOptional()
  @IsString()
  iceLevel?: string;

  @IsOptional()
  @IsString()
  temperature?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMaxSize(10, { message: 'Mỗi món chỉ được chọn tối đa 10 topping' })
  @IsString({ each: true })
  @MaxLength(50, { each: true, message: 'Tên topping không được vượt quá 50 ký tự' })
  toppings: string[];

  @IsInt()
  @Min(1)
  @Max(50)
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
  @ArrayMaxSize(50)
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsOptional()
  @IsString()
  discountCode?: string;
}
