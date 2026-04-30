// Fixture: estruturais (class, interface, type_alias, enum, module)

export interface Repo<T> {
  find(id: string): Promise<T | null>;
}

export type UserId = string;

export enum Role {
  Admin = 'admin',
  User = 'user',
}

export abstract class BaseService<T> {
  abstract handle(input: T): Promise<void>;
}

export class UsersService extends BaseService<UserId> implements Repo<string> {
  async handle(_id: UserId): Promise<void> {}
  find(_id: string): Promise<string | null> {
    return Promise.resolve(null);
  }
}
