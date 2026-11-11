import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateStaffDto } from './dto/create-staff.dto.js';
import { UpdateStaffDto } from './dto/update-staff.dto.js';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getAllStaff() {
    const users = await this.prisma.user.findMany({
      where: {
        role: {
          in: [Role.STAFF, Role.ADMIN],
        },
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        position: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: {
        id: 'asc',
      },
    });
    return users;
  }

  async getStaffById(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        position: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException(`Không tìm thấy nhân viên với ID ${id}`);
    }
    return user;
  }

  async createStaff(
    dto: CreateStaffDto,
    creator?: { userId?: number; email?: string; role?: Role } | string | number,
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new BadRequestException('Email này đã được sử dụng');
    }

    const requestedRole = dto.role || Role.STAFF;

    if (requestedRole !== Role.STAFF) {
      let creatorEmail: string | undefined;

      if (typeof creator === 'string') {
        creatorEmail = creator;
      } else if (creator && typeof creator === 'object') {
        creatorEmail = creator.email;
        if (!creatorEmail && creator.userId) {
          const creatorUser = await this.prisma.user.findUnique({
            where: { id: creator.userId },
            select: { email: true },
          });
          creatorEmail = creatorUser?.email;
        }
      } else if (typeof creator === 'number') {
        const creatorUser = await this.prisma.user.findUnique({
          where: { id: creator },
          select: { email: true },
        });
        creatorEmail = creatorUser?.email;
      }

      if (creatorEmail !== 'admin@brewlite.vn') {
        throw new BadRequestException(
          'Chỉ Quản trị viên Tối cao (Root Admin) mới có quyền tạo tài khoản Quản trị viên (Admin)',
        );
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        passwordHash: hashedPassword,
        fullName: dto.fullName.trim(),
        phone: dto.phone ? dto.phone.trim() : null,
        position: dto.position ? dto.position.trim() : 'Nhân viên',
        role: requestedRole,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        position: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return user;
  }

  async updateStaff(
    id: number,
    dto: UpdateStaffDto,
    currentAdminId?: number,
  ) {
    if (dto.isActive === false && currentAdminId && id === currentAdminId) {
      throw new BadRequestException(
        'Bạn không thể tự khóa hoặc xóa tài khoản của chính mình',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Không tìm thấy nhân viên với ID ${id}`);
    }

    // Chặn đổi email của Root Admin
    if (
      user.email === 'admin@brewlite.vn' &&
      dto.email &&
      dto.email.toLowerCase().trim() !== user.email
    ) {
      throw new BadRequestException(
        'Không thể thay đổi địa chỉ email của Quản trị viên Tối cao (Root Admin).',
      );
    }

    // Chặn Admin tự hạ quyền của chính mình
    if (
      dto.role &&
      dto.role !== Role.ADMIN &&
      currentAdminId &&
      id === currentAdminId
    ) {
      throw new BadRequestException(
        'Bạn không thể tự hạ quyền Quản trị viên của chính mình.',
      );
    }

    if (user.email === 'admin@brewlite.vn') {
      if (dto.isActive === false) {
        throw new BadRequestException(
          'Tài khoản Quản trị viên Tối cao (Root Admin) không thể bị xóa hoặc vô hiệu hóa',
        );
      }
      if (dto.role && dto.role !== Role.ADMIN) {
        throw new BadRequestException(
          'Không thể thay đổi vai trò của Quản trị viên Tối cao (Root Admin)',
        );
      }
    }

    // Chặn hạ quyền nếu hệ thống chỉ còn 1 Admin duy nhất hoạt động
    if (user.role === Role.ADMIN && dto.role && dto.role !== Role.ADMIN) {
      const activeAdminCount = await this.prisma.user.count({
        where: { role: Role.ADMIN, isActive: true },
      });
      if (activeAdminCount <= 1) {
        throw new BadRequestException(
          'Không thể hạ quyền Quản trị viên duy nhất còn lại trong hệ thống.',
        );
      }
    }

    if (user.role === Role.ADMIN && dto.isActive === false) {
      const activeAdminCount = await this.prisma.user.count({
        where: {
          role: Role.ADMIN,
          isActive: true,
        },
      });
      if (activeAdminCount <= 1) {
        throw new BadRequestException(
          'Không thể vô hiệu hóa Admin duy nhất còn hoạt động trong hệ thống',
        );
      }
    }

    // Bảo mật AUTH-03: Chỉ Root Admin mới có quyền thăng cấp tài khoản lên ADMIN
    if (dto.role === Role.ADMIN && user.role !== Role.ADMIN) {
      let currentAdminEmail: string | undefined;
      if (currentAdminId) {
        const adminUser = await this.prisma.user.findUnique({
          where: { id: currentAdminId },
          select: { email: true },
        });
        currentAdminEmail = adminUser?.email;
      }
      if (currentAdminEmail !== 'admin@brewlite.vn') {
        throw new BadRequestException(
          'Chỉ Quản trị viên Tối cao (Root Admin) mới có quyền thăng cấp tài khoản lên Quản trị viên (Admin)',
        );
      }
    }

    if (dto.email && dto.email.toLowerCase().trim() !== user.email) {
      const emailExists = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase().trim() },
      });
      if (emailExists) {
        throw new BadRequestException(
          'Email này đã được tài khoản khác sử dụng',
        );
      }
    }

    const updateData: any = {};
    if (dto.email !== undefined)
      updateData.email = dto.email.toLowerCase().trim();
    if (dto.fullName !== undefined) updateData.fullName = dto.fullName.trim();
    if (dto.phone !== undefined)
      updateData.phone = dto.phone ? dto.phone.trim() : null;
    if (dto.position !== undefined)
      updateData.position = dto.position ? dto.position.trim() : null;
    if (dto.role !== undefined) updateData.role = dto.role;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.password) {
      updateData.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        position: true,
        role: true,
        isActive: true,
      },
    });

    return updated;
  }

  async toggleStaffStatus(
    id: number,
    isActive: boolean,
    currentAdminId?: number,
  ) {
    if (currentAdminId && id === currentAdminId) {
      throw new BadRequestException(
        'Bạn không thể tự khóa hoặc xóa tài khoản của chính mình',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Không tìm thấy nhân viên với ID ${id}`);
    }

    if (user.email === 'admin@brewlite.vn') {
      throw new BadRequestException(
        'Tài khoản Quản trị viên Tối cao (Root Admin) không thể bị xóa hoặc vô hiệu hóa',
      );
    }

    if (user.role === Role.ADMIN && isActive === false) {
      const activeAdminCount = await this.prisma.user.count({
        where: {
          role: Role.ADMIN,
          isActive: true,
        },
      });
      if (activeAdminCount <= 1) {
        throw new BadRequestException(
          'Không thể vô hiệu hóa Admin duy nhất còn hoạt động trong hệ thống',
        );
      }
    }

    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
      },
    });
  }

  async deleteStaff(id: number, currentAdminId?: number) {
    if (currentAdminId && id === currentAdminId) {
      throw new BadRequestException(
        'Bạn không thể tự khóa hoặc xóa tài khoản của chính mình',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Không tìm thấy nhân viên với ID ${id}`);
    }

    if (user.email === 'admin@brewlite.vn') {
      throw new BadRequestException(
        'Tài khoản Quản trị viên Tối cao (Root Admin) không thể bị xóa hoặc vô hiệu hóa',
      );
    }

    if (user.role === Role.ADMIN) {
      const activeAdminCount = await this.prisma.user.count({
        where: {
          role: Role.ADMIN,
          isActive: true,
        },
      });
      if (activeAdminCount <= 1) {
        throw new BadRequestException(
          'Không thể xóa Admin duy nhất còn hoạt động trong hệ thống',
        );
      }
    }

    try {
      await this.prisma.user.delete({
        where: { id },
      });
      return { success: true, message: `Đã xóa nhân viên ${user.fullName}` };
    } catch (err: any) {
      // Nếu có ràng buộc dữ liệu (đơn hàng, audits...), chuyển sang vô hiệu hóa tài khoản
      await this.prisma.user.update({
        where: { id },
        data: { isActive: false },
      });
      return {
        success: true,
        message: `Nhân viên ${user.fullName} đã có lịch sử dữ liệu hoạt động nên tài khoản đã được chuyển sang trạng thái Vô hiệu hóa/Khóa.`,
      };
    }
  }
}
