export interface UserDto {
  id: string
  name: string
  email: string
  role: UserRole
}

export interface OrderDto {
  id: string
  userId: string
  total: number
  status: OrderStatus
}

export interface CreateUserRequest {
  name: string
  email: string
  role?: UserRole
}

export interface CreateOrderRequest {
  userId: string
  total: number
}

export enum UserRole {
  Admin = 'admin',
  User = 'user',
  Guest = 'guest',
}

export enum OrderStatus {
  Pending = 'pending',
  Shipped = 'shipped',
  Cancelled = 'cancelled',
}

export type GatewayResponse<T> = {
  data: T
  timestamp: string
}
