import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import simpleGit from 'simple-git';
import type {
  IExtractionSourceAdapter,
  SourceDescriptor,
  PreparedSource,
  ClonePolicy,
} from '../interfaces/extraction-source-adapter.interface';

@Injectable()
export class GitAdapter implements IExtractionSourceAdapter {
  constructor(private readonly config: ConfigService) {}

  supports(descriptor: SourceDescriptor): boolean {
    return descriptor.kind === 'git';
  }

  async prepare(descriptor: SourceDescriptor, policyOverride?: ClonePolicy): Promise<PreparedSource> {
    if (descriptor.kind !== 'git') {
      throw new Error('GitAdapter only supports git sources');
    }

    const reposDir = this.config.getOrThrow<string>('REPOS_DIR');
    const defaultPolicy = this.config.get<ClonePolicy>('CLONE_POLICY', 'delete');
    const policy: ClonePolicy = policyOverride ?? defaultPolicy;

    // Destino: REPOS_DIR/{slug}/{hash-da-url+branch+ref}/
    const slug = this.slugify(descriptor.url);
    const hash = this.shortHash(
      descriptor.url + (descriptor.branch ?? '') + (descriptor.ref ?? ''),
    );
    const cloneDir = join(reposDir, slug, hash);

    // Se persist e o diretório já existe, reutiliza sem clonar novamente
    if (policy === 'persist' && existsSync(cloneDir)) {
      return {
        localPath: cloneDir,
        cleanup: async () => {},
      };
    }

    mkdirSync(cloneDir, { recursive: true });

    const cloneOptions: string[] = ['--depth', '1'];
    if (descriptor.branch) cloneOptions.push('--branch', descriptor.branch);

    await simpleGit().clone(descriptor.url, cloneDir, cloneOptions);

    if (descriptor.ref) {
      await simpleGit(cloneDir).checkout(descriptor.ref);
    }

    return {
      localPath: cloneDir,
      cleanup: async () => {
        if (policy === 'delete') {
          rmSync(cloneDir, { recursive: true, force: true });
        }
      },
    };
  }

  private slugify(url: string): string {
    return url
      .replace(/^https?:\/\//, '')
      .replace(/\.git$/, '')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .toLowerCase()
      .slice(0, 80);
  }

  private shortHash(input: string): string {
    return createHash('sha1').update(input).digest('hex').slice(0, 8);
  }
}
