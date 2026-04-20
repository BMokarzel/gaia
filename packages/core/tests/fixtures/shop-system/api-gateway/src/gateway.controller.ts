import { Controller, Get, Post, Body, Param, HttpCode } from '@nestjs/common'
import { GatewayService } from './gateway.service'
import type { CreateUserRequest, CreateOrderRequest, UserDto, OrderDto, GatewayResponse } from './types'

@Controller('api')
export class GatewayController {
  constructor(private readonly gateway: GatewayService) {}

  @Get('users')
  async getUsers(): Promise<GatewayResponse<UserDto[]>> {
    const data = await this.gateway.getUsers()
    return { data, timestamp: new Date().toISOString() }
  }

  @Post('users')
  async createUser(@Body() body: CreateUserRequest): Promise<GatewayResponse<UserDto>> {
    if (!body.name || !body.email) {
      throw new Error('name and email are required')
    }
    const data = await this.gateway.createUser(body)
    return { data, timestamp: new Date().toISOString() }
  }

  @Get('users/:id')
  async getUser(@Param('id') id: string): Promise<GatewayResponse<UserDto>> {
    const data = await this.gateway.getUser(id)
    return { data, timestamp: new Date().toISOString() }
  }

  @Get('orders')
  async getOrders(): Promise<GatewayResponse<OrderDto[]>> {
    const data = await this.gateway.getOrders()
    return { data, timestamp: new Date().toISOString() }
  }

  @Post('orders')
  @HttpCode(201)
  async createOrder(@Body() body: CreateOrderRequest): Promise<GatewayResponse<OrderDto>> {
    if (!body.userId || !body.total) {
      throw new Error('userId and total are required')
    }
    const data = await this.gateway.createOrder(body)
    return { data, timestamp: new Date().toISOString() }
  }
}
