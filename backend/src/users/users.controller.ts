import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CreateStaffDto } from './dto/create-staff.dto.js';
import { UpdateStaffDto } from './dto/update-staff.dto.js';
import { UsersService } from './users.service.js';

@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  getAllStaff() {
    return this.usersService.getAllStaff();
  }

  @Get(':id')
  getStaffById(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getStaffById(id);
  }

  @Post()
  createStaff(@Request() req: any, @Body() dto: CreateStaffDto) {
    return this.usersService.createStaff(dto, req.user);
  }

  @Patch(':id')
  updateStaff(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStaffDto,
    @Request() req: any,
  ) {
    return this.usersService.updateStaff(id, dto, req.user?.userId);
  }

  @Patch(':id/status')
  toggleStaffStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('isActive') isActive: boolean,
    @Request() req: any,
  ) {
    return this.usersService.toggleStaffStatus(id, isActive, req.user?.userId);
  }

  @Delete(':id')
  deleteStaff(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.usersService.deleteStaff(id, req.user?.userId);
  }
}
