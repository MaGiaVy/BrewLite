import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

type PrismaError =
  | Prisma.PrismaClientKnownRequestError
  | Prisma.PrismaClientValidationError
  | Prisma.PrismaClientUnknownRequestError;

@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientUnknownRequestError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: PrismaError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        response.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          message: 'Dữ liệu đã tồn tại (trùng khóa duy nhất).',
          error: 'Conflict',
        });
        return;
      }

      if (exception.code === 'P2025') {
        response.status(HttpStatus.NOT_FOUND).json({
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Không tìm thấy bản ghi tương ứng.',
          error: 'Not Found',
        });
        return;
      }

      if (
        exception.code === 'P2020' ||
        exception.code === 'P2003' ||
        /out of range|Unable to fit integer/i.test(exception.message)
      ) {
        response.status(HttpStatus.BAD_REQUEST).json({
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Giá trị tham chiếu hoặc tham số số nguyên không hợp lệ.',
          error: 'Bad Request',
        });
        return;
      }
    }

    if (
      exception instanceof Prisma.PrismaClientValidationError ||
      /Unable to fit integer|out of range for type integer|22003/i.test(
        exception.message,
      )
    ) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Dữ liệu đầu vào vượt quá giới hạn hoặc sai định dạng.',
        error: 'Bad Request',
      });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Lỗi hệ thống cơ sở dữ liệu.',
      error: 'Internal Server Error',
    });
  }
}
