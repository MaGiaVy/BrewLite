import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ProductsModule } from './products/products.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [ProductsModule, PrismaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
