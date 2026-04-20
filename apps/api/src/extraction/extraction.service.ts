import { Injectable, Inject } from '@nestjs/common';
import { analyzeRepository } from '@topology/core';
import type { SystemTopology, AnalysisOptions } from '@topology/core';
import type { IExtractionService } from './interfaces/extraction-service.interface';
import type {
  IExtractionSourceAdapter,
  SourceDescriptor,
  ClonePolicy,
} from './interfaces/extraction-source-adapter.interface';
import { LOCAL_SOURCE_ADAPTER, GIT_SOURCE_ADAPTER } from './tokens';

@Injectable()
export class ExtractionService implements IExtractionService {
  private readonly adapters: IExtractionSourceAdapter[];

  constructor(
    @Inject(LOCAL_SOURCE_ADAPTER) localAdapter: IExtractionSourceAdapter,
    @Inject(GIT_SOURCE_ADAPTER) gitAdapter: IExtractionSourceAdapter,
  ) {
    this.adapters = [localAdapter, gitAdapter];
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

    const prepared = await adapter.prepare(descriptor, policy);
    try {
      return await analyzeRepository(prepared.localPath, options);
    } finally {
      await prepared.cleanup();
    }
  }
}
