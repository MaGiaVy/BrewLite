import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateStaffDto } from './dto/create-staff.dto.js';
import { UpdateStaffDto } from './dto/update-staff.dto.js';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const ROOT_ADMIN_EMAIL = 'admin@brewlite.vn';
const ROOT_ADMIN_EMAILS = new Set([
  ROOT_ADMIN_EMAIL,
  '3124410414@sv.sgu.edu.vn',
]);

function isRootAdminEmail(email?: string | null): boolean {
  return Boolean(email && ROOT_ADMIN_EMAILS.has(email.toLowerCase().trim()));
}

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
    if (!user || user.role === Role.CUSTOMER) {
      throw new NotFoundException(`Không tìm thấy nhân viên với ID ${id}`);
    }
    return user;
  }

  async createStaff(
    dto: CreateStaffDto,
    _creator?: { userId?: number; email?: string; role?: Role } | string | number,
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new BadRequestException('Email này đã được sử dụng');
    }

    const requestedRole = dto.role || Role.STAFF;

    if (requestedRole !== Role.STAFF) {
      throw new BadRequestException(
        'Hệ thống chỉ duy trì 1 tài khoản Quản trị viên duy nhất (admin@brewlite.vn). Nhân viên tạo mới bắt buộc có vai trò STAFF.',
      );
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
    if (!user || user.role === Role.CUSTOMER) {
      throw new NotFoundException(`Không tìm thấy nhân viên với ID ${id}`);
    }

    if (dto.role === Role.CUSTOMER) {
      throw new BadRequestException(
        'Không thể chuyển vai trò nhân viên thành CUSTOMER qua endpoint quản lý nhân sự.',
      );
    }

    // Chỉ chính Root Admin mới được chỉnh sửa thông tin tài khoản Root Admin
    if (isRootAdminEmail(user.email)) {
      if (currentAdminId !== user.id) {
        throw new ForbiddenException(
          'Chỉ chính Quản trị viên Tối cao (admin@brewlite.vn) mới được chỉnh sửa thông tin tài khoản Admin.',
        );
      }
      if (dto.email && dto.email.toLowerCase().trim() !== user.email) {
        throw new BadRequestException(
          'Không thể thay đổi địa chỉ email của Quản trị viên Tối cao (Root Admin).',
        );
      }
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

    // Không cho phép vô hiệu hóa hoặc hạ quyền bất kỳ tài khoản Admin nào
    if (isRootAdminEmail(user.email) || user.role === Role.ADMIN) {
      if (dto.isActive === false) {
        throw new BadRequestException(
          'Tài khoản Quản trị viên (Admin) không thể bị xóa hoặc vô hiệu hóa',
        );
      }
      if (dto.role && dto.role !== Role.ADMIN) {
        throw new BadRequestException(
          'Không thể thay đổi vai trò của tài khoản Quản trị viên (Admin)',
        );
      }
    }

    // Chính sách Single Root Admin: không cho phép thăng cấp bất kỳ tài khoản nào lên ADMIN
    if (dto.role === Role.ADMIN && user.role !== Role.ADMIN) {
      throw new BadRequestException(
        'Hệ thống chỉ duy trì 1 tài khoản Quản trị viên duy nhất (admin@brewlite.vn). Không thể nâng cấp tài khoản khác lên vai trò Admin.',
      );
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
      updateData.tokenVersion = { increment: 1 };
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
    if (!user || user.role === Role.CUSTOMER) {
      throw new NotFoundException(`Không tìm thấy nhân viên với ID ${id}`);
    }

    if (isRootAdminEmail(user.email) || user.role === Role.ADMIN) {
      throw new BadRequestException(
        'Tài khoản Quản trị viên (Admin) không thể bị xóa hoặc vô hiệu hóa',
      );
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
    if (!user || user.role === Role.CUSTOMER) {
      throw new NotFoundException(`Không tìm thấy nhân viên với ID ${id}`);
    }

    if (isRootAdminEmail(user.email) || user.role === Role.ADMIN) {
      throw new BadRequestException(
        'Tài khoản Quản trị viên (Admin) không thể bị xóa hoặc vô hiệu hóa',
      );
    }

    try {
      await this.prisma.user.delete({
        where: { id },
      });
      return { success: true, message: `Đã xóa nhân viên ${user.fullName}` };
    } catch {
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
