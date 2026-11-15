import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ParseInt32Pipe } from '../common/pipes/parse-int32.pipe.js';
import { ToggleStatusDto } from '../common/dto/toggle-status.dto.js';
import { CustomersService } from './customers.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';

@Controller('admin/customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  getAllCustomers() {
    return this.customersService.getAllCustomers();
  }

  @Get(':id')
  getCustomerById(@Param('id', ParseInt32Pipe) id: number) {
    return this.customersService.getCustomerById(id);
  }

  @Post()
  createCustomer(@Body() dto: CreateCustomerDto) {
    return this.customersService.createCustomer(dto);
  }

  @Patch(':id')
  updateCustomer(
    @Param('id', ParseInt32Pipe) id: number,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.updateCustomer(id, dto);
  }

  @Patch(':id/status')
  toggleCustomerStatus(
    @Param('id', ParseInt32Pipe) id: number,
    @Body() dto: ToggleStatusDto,
  ) {
    return this.customersService.toggleCustomerStatus(id, dto.isActive);
  }

  @Delete(':id')
  deleteCustomer(@Param('id', ParseInt32Pipe) id: number) {
    return this.customersService.deleteCustomer(id);
  }
}
