export interface User {
  id: string;
  name: string;
}

export class UsersRepository {
  async save(user: User): Promise<User> {
    return user;
  }
  async findById(id: string): Promise<User | null> {
    return { id, name: 'x' };
  }
}
