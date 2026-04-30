// Fixture: declarações (parameter, field, variable, import_binding, decorator_ref, type_ref)

import { Injectable, Inject } from '@nestjs/common';
import type { Repo } from './structural';
import * as path from 'node:path';
import defaultExport from 'some-default';

@Injectable()
export class UsersService {
  public readonly cacheKey: string = 'users';
  private static counter = 0;

  constructor(
    @Inject('USER_REPO') private readonly repo: Repo<string>,
    private readonly basePath: string = path.resolve('.'),
  ) {}

  ref(): typeof defaultExport {
    return defaultExport;
  }
}
