import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllCustomers() {
    return this.prisma.user.findMany({
      where: { role: Role.CUSTOMER },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        isActive: true,
        loyaltyPoints: true,
        createdAt: true,
        _count: {
          select: { orders: true },
        },
      },
      orderBy: { id: 'desc' },
    });
  }

  async getCustomerById(id: number) {
    const customer = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        isActive: true,
        loyaltyPoints: true,
        createdAt: true,
        _count: {
          select: { orders: true },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Không tìm thấy khách hàng với ID ${id}`);
    }

    return customer;
  }

  async createCustomer(dto: CreateCustomerDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      throw new BadRequestException('Email này đã được sử dụng');
    }

    const rawPassword = dto.password?.trim() ? dto.password.trim() : '123456';
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    return this.prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: hashedPassword,
        fullName: dto.fullName.trim(),
        phone: dto.phone?.trim() || null,
        role: Role.CUSTOMER,
        loyaltyPoints: 0, // RÀNG BUỘC SỐNG CÒN: Điểm mặc định khi tạo mới = 0
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        isActive: true,
        loyaltyPoints: true,
        createdAt: true,
      },
    });
  }

  async updateCustomer(id: number, dto: UpdateCustomerDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Không tìm thấy khách hàng với ID ${id}`);
    }

    const data: {
      fullName?: string;
      phone?: string | null;
      isActive?: boolean;
      passwordHash?: string;
    } = {};

    if (dto.fullName !== undefined) {
      data.fullName = dto.fullName.trim();
    }

    if (dto.phone !== undefined) {
      data.phone = dto.phone ? dto.phone.trim() : null;
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    if (dto.password && dto.password.trim()) {
      data.passwordHash = await bcrypt.hash(dto.password.trim(), 10);
    }

    // RÀNG BUỘC SỐNG CÒN: Tuyệt đối không cho phép sửa loyaltyPoints
    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        isActive: true,
        loyaltyPoints: true,
        createdAt: true,
      },
    });
  }

  async toggleCustomerStatus(id: number, isActive: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Không tìm thấy khách hàng với ID ${id}`);
    }

    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        isActive: true,
        loyaltyPoints: true,
        createdAt: true,
      },
    });
  }

  async deleteCustomer(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Không tìm thấy khách hàng với ID ${id}`);
    }

    const ordersCount = await this.prisma.order.count({
      where: { userId: id },
    });

    if (ordersCount === 0) {
      await this.prisma.user.delete({ where: { id } });
      return {
        success: true,
        message: 'Đã xóa hoàn toàn tài khoản khách hàng.',
      };
    }

    await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    return {
      success: true,
      softDeleted: true,
      message: `Khách hàng đã có ${ordersCount} đơn hàng. Tài khoản đã được chuyển sang trạng thái Tạm khóa để bảo toàn dữ liệu doanh thu.`,
    };
  }
}
