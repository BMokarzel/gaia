import { Injectable, Inject } from '@nestjs/common';
import { analyzeRepository } from '@topology/core';
import type { SystemTopology, AnalysisOptions, Logger } from '@topology/core';
import type { IExtractionService } from './interfaces/extraction-service.interface';
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
  ): Promise<SystemTopology> {
    const adapter = this.adapters.find((a) => a.supports(descriptor));
    if (!adapter) {
      throw new Error(`No adapter found for source kind: ${(descriptor as any).kind}`);
    }

    this.log.info('Starting extraction', { kind: (descriptor as any).kind });
    const prepared = await adapter.prepare(descriptor, policy);
    try {
      const topology = await analyzeRepository(prepared.localPath, { ...options, logger: this.log });
      this.log.info('Extraction complete', {
        services: topology.services.length,
        errors: topology.diagnostics.filter(d => d.level === 'error').length,
      });
      return topology;
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
