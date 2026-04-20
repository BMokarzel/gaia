import { Injectable, NotFoundException } from '@nestjs/common';
import { existsSync } from 'fs';
import { resolve } from 'path';
import type {
  IExtractionSourceAdapter,
  SourceDescriptor,
  PreparedSource,
  ClonePolicy,
} from '../interfaces/extraction-source-adapter.interface';

@Injectable()
export class LocalDirectoryAdapter implements IExtractionSourceAdapter {
  supports(descriptor: SourceDescriptor): boolean {
    return descriptor.kind === 'local';
  }

  async prepare(descriptor: SourceDescriptor, _policy?: ClonePolicy): Promise<PreparedSource> {
    if (descriptor.kind !== 'local') {
      throw new Error('LocalDirectoryAdapter only supports local sources');
    }
    const localPath = resolve(descriptor.path);
    if (!existsSync(localPath)) {
      throw new NotFoundException('Source path not found');
    }
    return {
      localPath,
      cleanup: async () => {}, // diretórios locais nunca são removidos
    };
  }
}
