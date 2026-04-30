import { UsersRepository, type User } from './users.repository';

export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  async create(name: string): Promise<User> {
    const user: User = { id: 'x', name };
    return this.repo.save(user);
  }

  async find(id: string): Promise<User | null> {
    return this.repo.findById(id);
  }
}
