import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { PaymentsService } from './payments.service.js';

interface AuthRequest extends Request {
  user: { userId: number; email: string; role?: Role };
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  private assertSandboxAllowed(envFlag: string, message: string): void {
    if (process.env.NODE_ENV === 'production' && process.env[envFlag] !== 'true') {
      throw new ForbiddenException(message);
    }
  }

  /**
   * POST /payments — Thanh toán đơn hàng không tiền mặt (Mock Gateway / Kịch bản Demo)
   * Yêu cầu JWT Bearer Token, kiểm tra quyền sở hữu đơn hàng
   * Hỗ trợ header Idempotency-Key và cờ simulateFailure để demo
   */
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  processPayment(
    @Request() req: AuthRequest,
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // Bảo mật PAY-01: Chặn Mock Payment trên môi trường Production (trừ khi có cờ cho phép chạy demo)
    this.assertSandboxAllowed(
      'ALLOW_MOCK_PAYMENT',
      'Cổng thanh toán thử nghiệm (Mock Payment) đã bị vô hiệu hóa trên môi trường Production.',
    );
    return this.paymentsService.processPayment(
      dto,
      req.user.userId,
      idempotencyKey,
      req.user.role,
    );
  }

  /**
   * POST /payments/zalopay/create — Tạo liên kết thanh toán / QR trên ZaloPay Sandbox
   */
  @UseGuards(JwtAuthGuard)
  @Post('zalopay/create')
  @HttpCode(HttpStatus.OK)
  createZaloPayOrder(
    @Request() req: AuthRequest,
    @Body('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.paymentsService.createZaloPayOrder(
      orderId,
      req.user.userId,
      req.user.role,
    );
  }

  /**
   * POST /payments/zalopay/callback — Tiếp nhận IPN Webhook từ máy chủ ZaloPay
   */
  @Post('zalopay/callback')
  @HttpCode(HttpStatus.OK)
  handleZaloPayCallback(@Body() body: { data: string; mac: string; type?: number }) {
    return this.paymentsService.handleZaloPayCallback(body);
  }

  /**
   * GET /payments/zalopay/status/:orderId — Kiểm tra trạng thái thanh toán ZaloPay (Polling 3s)
   */
  @UseGuards(JwtAuthGuard)
  @Get('zalopay/status/:orderId')
  @HttpCode(HttpStatus.OK)
  getZaloPayStatus(
    @Request() req: AuthRequest,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Query('appTransId') appTransId?: string,
  ) {
    return this.paymentsService.getZaloPayStatus(
      orderId,
      req.user.userId,
      appTransId,
      req.user.role,
    );
  }

  /**
   * POST /payments/zalopay/confirm — Xác nhận thanh toán từ Cổng ZaloPay Sandbox Gateway
   * Yêu cầu JWT Bearer Token; quyền sở hữu đơn hàng (hoặc ADMIN/STAFF) được kiểm tra ở tầng service.
   */
  @UseGuards(JwtAuthGuard)
  @Post('zalopay/confirm')
  @HttpCode(HttpStatus.OK)
  confirmZaloPayOrder(
    @Request() req: AuthRequest,
    @Body('orderId', new ParseIntPipe({ optional: true })) orderId?: number | string,
    @Body('appTransId') appTransId?: string,
  ) {
    // Bảo mật PAY-01: Chặn bypass Sandbox confirm trên môi trường Production
    this.assertSandboxAllowed(
      'ALLOW_SANDBOX_CONFIRM',
      'Xác nhận thanh toán Sandbox bị vô hiệu hóa trên môi trường Production. Vui lòng sử dụng Webhook chính thức từ ZaloPay.',
    );
    const targetOrderId =
      orderId === undefined || orderId === null || orderId === ''
        ? undefined
        : typeof orderId === 'number'
          ? orderId
          : Number(orderId);
    return this.paymentsService.confirmZaloPaySandbox(
      targetOrderId,
      req.user.userId,
      req.user.role,
      appTransId,
    );
  }

  /**
   * POST /payments/zalopay/cancel — Hủy thanh toán từ Cổng ZaloPay Sandbox Gateway
   */
  @UseGuards(JwtAuthGuard)
  @Post('zalopay/cancel')
  @HttpCode(HttpStatus.OK)
  cancelZaloPayOrder(
    @Request() req: AuthRequest,
    @Body('orderId', ParseIntPipe) orderId: number,
  ) {
    // Bảo mật PAY-01 / BE-C1: Chặn Sandbox cancel trên môi trường Production
    this.assertSandboxAllowed(
      'ALLOW_SANDBOX_CONFIRM',
      'Hủy thanh toán Sandbox bị vô hiệu hóa trên môi trường Production.',
    );
    return this.paymentsService.cancelZaloPaySandbox(
      orderId,
      req.user.userId,
      req.user.role,
    );
  }
}
