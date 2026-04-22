import { IsString, IsArray, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MergeDecisionItemDto {
  @ApiProperty({ description: 'externalCallId from the PendingMergeEntry' })
  @IsString()
  externalCallId!: string;

  @ApiProperty({
    description: 'Resolved endpointId, "unresolvable", or null to skip',
    nullable: true,
  })
  decision!: string | null;
}

export class MergeDecisionDto {
  @ApiProperty({ description: 'Session ID from the analyze interim response' })
  @IsString()
  sessionId!: string;

  @ApiProperty({ type: [MergeDecisionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MergeDecisionItemDto)
  decisions!: MergeDecisionItemDto[];
}
