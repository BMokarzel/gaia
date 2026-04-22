import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PendingMergeEntry } from '@topology/core';

export class ExtractionProgressSummaryDto {
  @ApiProperty() servicesDetected!: number;
  @ApiProperty() endpointsExtracted!: number;
  @ApiProperty() databasesFound!: number;
  @ApiProperty() externalCallsTotal!: number;
  @ApiProperty() externalCallsResolved!: number;
  @ApiProperty() externalCallsPending!: number;
}

export class AnalyzeInterimResponseDto {
  @ApiProperty({ enum: ['pending_merge_decisions'] })
  status!: 'pending_merge_decisions';

  @ApiProperty({ description: 'Session ID to use when submitting merge decisions' })
  sessionId!: string;

  @ApiProperty({ type: [Object], description: 'Merge decisions awaiting user input' })
  pendingMerges!: PendingMergeEntry[];

  @ApiProperty({ type: ExtractionProgressSummaryDto })
  progress!: ExtractionProgressSummaryDto;
}

export class AnalyzeCompleteResponseDto {
  @ApiProperty({ enum: ['complete'] })
  status!: 'complete';

  @ApiProperty({ description: 'Topology ID (= repoName)' })
  topologyId!: string;

  @ApiProperty({ type: ExtractionProgressSummaryDto })
  summary!: ExtractionProgressSummaryDto;
}

export type AnalyzeResponseDto = AnalyzeInterimResponseDto | AnalyzeCompleteResponseDto;
