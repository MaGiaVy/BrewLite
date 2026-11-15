import { IsBoolean } from 'class-validator';

export class ToggleStatusDto {
  @IsBoolean({
    message: 'Trạng thái isActive bắt buộc phải là boolean (true/false)',
  })
  isActive: boolean;
}
