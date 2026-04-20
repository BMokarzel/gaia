import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('users')
export class UsersController {
  @Get()
  findAll() {
    return prisma.user.findMany();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  @Post()
  create(@Body() dto: { name: string; email: string }) {
    return prisma.user.create({ data: dto });
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: { name?: string }) {
    return prisma.user.update({ where: { id }, data: dto });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return prisma.user.delete({ where: { id } });
  }
}
