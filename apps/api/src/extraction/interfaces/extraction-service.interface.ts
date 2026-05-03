import type { SystemTopology, AnalysisOptions } from '@topology/core';
import type { SourceDescriptor, ClonePolicy } from './extraction-source-adapter.interface';

export interface ExtractionResult {
  topology: SystemTopology;
  /** ISO timestamp when extraction completed */
  analyzedAt: string;
  /** Git commit SHA when source is a git repo (best-effort) */
  commitSha?: string;
}

export interface IExtractionService {
  extract(
    descriptor: SourceDescriptor,
    options?: AnalysisOptions,
    policy?: ClonePolicy,
  ): Promise<ExtractionResult>;
}
