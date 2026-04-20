import { Controller, Get, Post, Put, Delete, Param, Body, HttpCode } from '@nestjs/common'
import { UsersService } from './users.service'

export interface CreateUserDto {
  name: string
  email: string
  role?: string
}

export interface UpdateUserDto {
  name?: string
  email?: string
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async getUsers() {
    return this.usersService.findAll()
  }

  @Post()
  async createUser(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto)
  }

  @Get(':id')
  async getUser(@Param('id') id: string) {
    return this.usersService.findById(id)
  }

  @Put(':id')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto)
  }

  @Delete(':id')
  @HttpCode(204)
  async deleteUser(@Param('id') id: string) {
    return this.usersService.delete(id)
  }
}
