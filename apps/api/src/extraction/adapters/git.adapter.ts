import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import simpleGit from 'simple-git';

const ALLOWED_SCHEMES = ['https:', 'http:', 'git:', 'ssh:'];

// RFC-1918 + loopback + link-local private ranges
const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|\[::1\])/;

function assertSafeGitUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // Non-URL formats like "git@github.com:org/repo" are SCP-style SSH — allow them
    // but block any path that starts with a slash followed by system directories
    if (/^\//.test(rawUrl)) {
      throw new BadRequestException('Local filesystem paths are not allowed as git URLs');
    }
    return;
  }

  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    throw new BadRequestException(`Git URL scheme "${parsed.protocol}" is not allowed`);
  }

  if (PRIVATE_IP_RE.test(parsed.hostname)) {
    throw new BadRequestException('Git URLs pointing to private/loopback addresses are not allowed');
  }
}
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

    assertSafeGitUrl(descriptor.url);

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
