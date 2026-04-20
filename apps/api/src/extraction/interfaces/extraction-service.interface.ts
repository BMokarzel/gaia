import type { SystemTopology, AnalysisOptions } from '@topology/core';
import type { SourceDescriptor, ClonePolicy } from './extraction-source-adapter.interface';

export interface IExtractionService {
  extract(
    descriptor: SourceDescriptor,
    options?: AnalysisOptions,
    policy?: ClonePolicy,
  ): Promise<SystemTopology>;
}
