import { Injectable, NotFoundException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaClient } from '@prisma/client'
import { trace, metrics } from '@opentelemetry/api'
import * as winston from 'winston'
import type { UserDto, OrderDto, CreateUserRequest, CreateOrderRequest } from './types'

const logger = winston.createLogger({ level: 'info', transports: [new winston.transports.Console()] })
const tracer = trace.getTracer('api-gateway')
const meter = metrics.getMeter('api-gateway')
const requestCounter = meter.createCounter('gateway.requests')

const USER_SERVICE = 'http://user-service:8081'
const ORDER_SERVICE = 'http://order-service:8082'

@Injectable()
export class GatewayService {
  private readonly prisma = new PrismaClient()

  constructor(private readonly emitter: EventEmitter2) {}

  async getUsers(): Promise<UserDto[]> {
    const span = tracer.startSpan('gateway.getUsers')
    logger.info('proxying GET /users to user-service')
    requestCounter.add(1, { route: 'getUsers' })
    try {
      const res = await fetch(`${USER_SERVICE}/users`)
      if (!res.ok) {
        logger.error(`user-service returned ${res.status}`)
        throw new Error(`upstream error: ${res.status}`)
      }
      const users = await res.json() as UserDto[]
      logger.debug(`received ${users.length} users from user-service`)
      span.end()
      return users
    } catch (error) {
      logger.error('failed to fetch users', { error })
      span.end()
      throw error
    }
  }

  async createUser(body: CreateUserRequest): Promise<UserDto> {
    const span = tracer.startSpan('gateway.createUser')
    logger.info(`proxying POST /users to user-service name=${body.name}`)
    try {
      const res = await fetch(`${USER_SERVICE}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        logger.warn(`user-service rejected create status=${res.status}`)
        throw new Error(`upstream error: ${res.status}`)
      }
      const user = await res.json() as UserDto
      await this.prisma.auditLog.create({ data: { action: 'user.created', targetId: user.id } })
      this.emitter.emit('user.created', { id: user.id })
      logger.info(`user created via gateway id=${user.id}`)
      span.end()
      return user
    } catch (error) {
      logger.error('failed to create user', { error })
      span.end()
      throw error
    }
  }

  async getUser(id: string): Promise<UserDto> {
    logger.info(`proxying GET /users/${id} to user-service`)
    const res = await fetch(`${USER_SERVICE}/users/${id}`)
    if (!res.ok) {
      logger.warn(`user not found id=${id}`)
      throw new NotFoundException(`user ${id} not found`)
    }
    return res.json() as Promise<UserDto>
  }

  async getOrders(): Promise<OrderDto[]> {
    const span = tracer.startSpan('gateway.getOrders')
    logger.info('proxying GET /orders to order-service')
    requestCounter.add(1, { route: 'getOrders' })
    try {
      const res = await fetch(`${ORDER_SERVICE}/orders`)
      if (!res.ok) {
        logger.error(`order-service returned ${res.status}`)
        throw new Error(`upstream error: ${res.status}`)
      }
      const orders = await res.json() as OrderDto[]
      span.end()
      return orders
    } catch (error) {
      logger.error('failed to fetch orders', { error })
      span.end()
      throw error
    }
  }

  async createOrder(body: CreateOrderRequest): Promise<OrderDto> {
    const span = tracer.startSpan('gateway.createOrder')
    logger.info(`proxying POST /orders to order-service userId=${body.userId}`)
    try {
      const res = await fetch(`${ORDER_SERVICE}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        logger.warn(`order-service rejected create status=${res.status}`)
        throw new Error(`upstream error: ${res.status}`)
      }
      const order = await res.json() as OrderDto
      await this.prisma.auditLog.create({ data: { action: 'order.created', targetId: order.id } })
      this.emitter.emit('order.created', { id: order.id })
      logger.info(`order created via gateway id=${order.id}`)
      span.end()
      return order
    } catch (error) {
      logger.error('failed to create order', { error })
      span.end()
      throw error
    }
  }
}
