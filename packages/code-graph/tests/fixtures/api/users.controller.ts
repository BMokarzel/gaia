import { UsersService } from './users.service';

export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  async createUser(name: string): Promise<unknown> {
    if (!name) {
      throw new Error('name required');
    }
    return this.usersService.create(name);
  }
}
