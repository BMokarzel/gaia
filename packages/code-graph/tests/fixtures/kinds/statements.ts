// Fixture: statements (call_site, return_site, throw_site, assign_site, await_site)

import { readFileSync } from 'node:fs';

export class Service {
  async run(path: string): Promise<string> {
    const raw = readFileSync(path, 'utf8');
    if (!raw) {
      throw new Error('empty file');
    }
    const trimmed = raw.trim();
    await Promise.resolve();
    return trimmed;
  }
}
