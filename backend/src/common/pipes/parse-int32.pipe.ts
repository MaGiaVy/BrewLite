import {
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

export const INT32_MAX = 2_147_483_647;

@Injectable()
export class ParseInt32Pipe implements PipeTransform<string | number, number> {
  transform(value: string | number): number {
    let parsed: number;
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        throw new BadRequestException('ID không hợp lệ (phải là số nguyên dương)');
      }
      parsed = value;
    } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      parsed = Number(value.trim());
    } else {
      throw new BadRequestException('ID không hợp lệ (phải là số nguyên dương)');
    }
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > INT32_MAX) {
      throw new BadRequestException(
        `ID vượt quá giới hạn cho phép (1..${INT32_MAX})`,
      );
    }
    return parsed;
  }
}
