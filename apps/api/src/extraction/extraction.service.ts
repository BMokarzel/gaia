import { Injectable, Inject } from '@nestjs/common';
import { spawnSync } from 'child_process';
import { analyzeRepository } from '@topology/core';
import type { AnalysisOptions, Logger } from '@topology/core';
import type { IExtractionService, ExtractionResult } from './interfaces/extraction-service.interface';
import type {
  IExtractionSourceAdapter,
  SourceDescriptor,
  ClonePolicy,
} from './interfaces/extraction-source-adapter.interface';
import { LOCAL_SOURCE_ADAPTER, GIT_SOURCE_ADAPTER } from './tokens';
import { LOGGER_TOKEN } from '../common/logger/logger.token';

@Injectable()
export class ExtractionService implements IExtractionService {
  private readonly adapters: IExtractionSourceAdapter[];
  private readonly log: Logger;

  constructor(
    @Inject(LOCAL_SOURCE_ADAPTER) localAdapter: IExtractionSourceAdapter,
    @Inject(GIT_SOURCE_ADAPTER) gitAdapter: IExtractionSourceAdapter,
    @Inject(LOGGER_TOKEN) logger: Logger,
  ) {
    this.adapters = [localAdapter, gitAdapter];
    this.log = logger.child({ component: 'extraction.service' });
  }

  async extract(
    descriptor: SourceDescriptor,
    options?: AnalysisOptions,
    policy?: ClonePolicy,
  ): Promise<ExtractionResult> {
    const adapter = this.adapters.find((a) => a.supports(descriptor));
    if (!adapter) {
      throw new Error(`No adapter found for source kind: ${(descriptor as any).kind}`);
    }

    this.log.info('Starting extraction', { kind: (descriptor as any).kind });
    const prepared = await adapter.prepare(descriptor, policy);
    try {
      const topology = await analyzeRepository(prepared.localPath, { ...options, logger: this.log });
      const commitSha = readGitSha(prepared.localPath);
      const analyzedAt = new Date().toISOString();
      this.log.info('Extraction complete', {
        services: topology.services.length,
        errors: topology.diagnostics.filter(d => d.level === 'error').length,
        commitSha: commitSha ?? null,
      });
      return { topology, analyzedAt, ...(commitSha ? { commitSha } : {}) };
    } catch (err) {
      this.log.error('Extraction failed', err instanceof Error ? err : undefined, {
        kind: (descriptor as any).kind,
      });
      throw err;
    } finally {
      await prepared.cleanup();
    }
  }
}

/** Best-effort `git rev-parse HEAD` against the prepared path. Returns undefined if the path is not a git working tree, git is missing, or the command fails. */
function readGitSha(cwd: string): string | undefined {
  try {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      shell: false,
    });
    if (result.status !== 0) return undefined;
    const sha = result.stdout.trim();
    return /^[a-f0-9]{40}$/i.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}
