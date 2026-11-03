import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';

describe('CustomersController', () => {
  let controller: CustomersController;
  let service: {
    getAllCustomers: ReturnType<typeof vi.fn>;
    getCustomerById: ReturnType<typeof vi.fn>;
    createCustomer: ReturnType<typeof vi.fn>;
    updateCustomer: ReturnType<typeof vi.fn>;
    toggleCustomerStatus: ReturnType<typeof vi.fn>;
    deleteCustomer: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      getAllCustomers: vi.fn(),
      getCustomerById: vi.fn(),
      createCustomer: vi.fn(),
      updateCustomer: vi.fn(),
      toggleCustomerStatus: vi.fn(),
      deleteCustomer: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        {
          provide: CustomersService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<CustomersController>(CustomersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getAllCustomers gọi service.getAllCustomers', async () => {
    service.getAllCustomers.mockResolvedValue([]);
    await controller.getAllCustomers();
    expect(service.getAllCustomers).toHaveBeenCalled();
  });

  it('getCustomerById gọi service.getCustomerById với id', async () => {
    service.getCustomerById.mockResolvedValue({ id: 1 });
    await controller.getCustomerById(1);
    expect(service.getCustomerById).toHaveBeenCalledWith(1);
  });

  it('createCustomer gọi service.createCustomer với dto', async () => {
    const dto: CreateCustomerDto = {
      email: 'a@b.com',
      fullName: 'A B',
    };
    service.createCustomer.mockResolvedValue({ id: 1, ...dto });
    await controller.createCustomer(dto);
    expect(service.createCustomer).toHaveBeenCalledWith(dto);
  });

  it('updateCustomer gọi service.updateCustomer với id và dto', async () => {
    const dto: UpdateCustomerDto = {
      fullName: 'New Name',
    };
    service.updateCustomer.mockResolvedValue({ id: 1, ...dto });
    await controller.updateCustomer(1, dto);
    expect(service.updateCustomer).toHaveBeenCalledWith(1, dto);
  });

  it('toggleCustomerStatus gọi service.toggleCustomerStatus với id và status', async () => {
    service.toggleCustomerStatus.mockResolvedValue({ id: 1, isActive: false });
    await controller.toggleCustomerStatus(1, false);
    expect(service.toggleCustomerStatus).toHaveBeenCalledWith(1, false);
  });

  it('deleteCustomer gọi service.deleteCustomer với id', async () => {
    service.deleteCustomer.mockResolvedValue({ success: true });
    await controller.deleteCustomer(1);
    expect(service.deleteCustomer).toHaveBeenCalledWith(1);
  });
});
