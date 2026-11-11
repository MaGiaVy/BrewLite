import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

describe('OrdersController', () => {
  let controller: OrdersController;
  let service: {
    createOrder: ReturnType<typeof vi.fn>;
    getMyOrders: ReturnType<typeof vi.fn>;
    getOrderById: ReturnType<typeof vi.fn>;
    updateOrderStatus: ReturnType<typeof vi.fn>;
    deleteOrder: ReturnType<typeof vi.fn>;
    getBaristaQueue: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      createOrder: vi.fn(),
      getMyOrders: vi.fn(),
      getOrderById: vi.fn(),
      updateOrderStatus: vi.fn(),
      deleteOrder: vi.fn(),
      getBaristaQueue: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        {
          provide: OrdersService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<OrdersController>(OrdersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getMyOrders should call service.getMyOrders with req.user.userId', async () => {
    const mockReq = { user: { userId: 5, email: 'test@example.com' } };
    service.getMyOrders.mockResolvedValue([]);

    await controller.getMyOrders(mockReq as any);

    expect(service.getMyOrders).toHaveBeenCalledWith(5);
  });

  it('updateOrderStatus should call service.updateOrderStatus with orderId, status, userId and role', async () => {
    const mockReq = {
      user: { userId: 7, email: 'barista@brewlite.com', role: 'STAFF' },
    };
    const mockResult = { orderId: 10, status: 'PREPARING' };
    service.updateOrderStatus.mockResolvedValue(mockResult);

    const result = await controller.updateOrderStatus(
      mockReq as any,
      10,
      { status: 'PREPARING' as any },
    );

    expect(service.updateOrderStatus).toHaveBeenCalledWith(
      10,
      'PREPARING',
      7,
      'STAFF',
    );
    expect(result).toEqual(mockResult);
  });

  it('updateOrderStatus should forward customer role when customer cancels order', async () => {
    const mockReq = {
      user: { userId: 5, email: 'customer@brewlite.com', role: 'CUSTOMER' },
    };
    const mockResult = { orderId: 10, status: 'CANCELLED' };
    service.updateOrderStatus.mockResolvedValue(mockResult);

    const result = await controller.updateOrderStatus(
      mockReq as any,
      10,
      { status: 'CANCELLED' as any },
    );

    expect(service.updateOrderStatus).toHaveBeenCalledWith(
      10,
      'CANCELLED',
      5,
      'CUSTOMER',
    );
    expect(result).toEqual(mockResult);
  });

  it('updateOrderStatus should forward customer role when customer retries PAYMENT_FAILED order to PENDING', async () => {
    const mockReq = {
      user: { userId: 5, email: 'customer@brewlite.com', role: 'CUSTOMER' },
    };
    const mockResult = {
      orderId: 10,
      previousStatus: 'PAYMENT_FAILED',
      status: 'PENDING',
    };
    service.updateOrderStatus.mockResolvedValue(mockResult);

    const result = await controller.updateOrderStatus(
      mockReq as any,
      10,
      { status: 'PENDING' as any },
    );

    expect(service.updateOrderStatus).toHaveBeenCalledWith(
      10,
      'PENDING',
      5,
      'CUSTOMER',
    );
    expect(result).toEqual(mockResult);
  });

  it('deleteOrder should call service.deleteOrder with orderId, userId and role', async () => {
    const mockReq = {
      user: { userId: 5, email: 'customer@brewlite.com', role: 'CUSTOMER' },
    };
    const mockResult = { success: true, message: 'Đã xóa đơn hàng #10' };
    service.deleteOrder.mockResolvedValue(mockResult);

    const result = await controller.deleteOrder(mockReq as any, 10);

    expect(service.deleteOrder).toHaveBeenCalledWith(10, 5, 'CUSTOMER');
    expect(result).toEqual(mockResult);
  });
});
