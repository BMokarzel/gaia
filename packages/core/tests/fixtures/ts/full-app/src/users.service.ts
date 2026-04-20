import { Injectable, NotFoundException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaClient } from '@prisma/client'
import { trace, metrics } from '@opentelemetry/api'
import * as winston from 'winston'

const logger = winston.createLogger({ level: 'info' })
const tracer = trace.getTracer('users-service')
const meter = metrics.getMeter('users-service')
const requestCounter = meter.createCounter('users.requests')

@Injectable()
export class UsersService {
  private readonly prisma = new PrismaClient()

  constructor(private readonly emitter: EventEmitter2) {}

  async findAll() {
    const span = tracer.startSpan('findAll')
    logger.info('Fetching all users')
    requestCounter.add(1, { operation: 'findAll' })

    try {
      const users = await this.prisma.user.findMany()
      logger.debug(`Found ${users.length} users`)
      span.end()
      return users
    } catch (error) {
      logger.error('Failed to fetch users', { error })
      span.end()
      throw error
    }
  }

  async create(dto: { name: string; email: string; role?: string }) {
    const span = tracer.startSpan('create')
    logger.info(`Creating user: ${dto.name}`)

    if (!dto.name || !dto.email) {
      logger.warn('Missing required fields for user creation')
      throw new Error('Name and email are required')
    }

    const user = await this.prisma.user.create({ data: dto })

    this.emitter.emit('user.created', { id: user.id, email: user.email })
    logger.info(`User created id=${user.id}`)
    span.end()
    return user
  }

  async findById(id: string) {
    logger.debug(`Fetching user id=${id}`)

    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) {
      logger.warn(`User not found id=${id}`)
      throw new NotFoundException(`User ${id} not found`)
    }

    return user
  }

  async update(id: string, dto: { name?: string; email?: string }) {
    logger.info(`Updating user id=${id}`)

    const existing = await this.prisma.user.findFirst({ where: { id } })
    if (!existing) {
      logger.warn(`User not found for update id=${id}`)
      throw new NotFoundException(`User ${id} not found`)
    }

    const updated = await this.prisma.user.update({ where: { id }, data: dto })

    this.emitter.emit('user.updated', { id, changes: dto })
    logger.info(`User updated id=${id}`)
    return updated
  }

  async delete(id: string) {
    logger.info(`Deleting user id=${id}`)

    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) {
      logger.error(`Attempted to delete non-existent user id=${id}`)
      throw new NotFoundException(`User ${id} not found`)
    }

    await this.prisma.user.delete({ where: { id } })
    await this.prisma.order.deleteMany({ where: { userId: id } })

    this.emitter.emit('user.deleted', { id })
    logger.info(`User deleted id=${id}`)
  }

  async getStats() {
    const span = tracer.startSpan('getStats')
    logger.info('Fetching user stats')

    const count = await this.prisma.user.count()
    const orders = await this.prisma.order.findMany()

    for (const order of orders) {
      if (order.total > 1000) {
        logger.warn(`High value order id=${order.id}`)
        this.emitter.emit('order.high-value', { orderId: order.id })
      }
    }

    span.end()
    return { userCount: count, orderCount: orders.length }
  }
}
