import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SimulationTogglesDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'externalCall ids to treat as failing',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  failingExternalIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'dbProcess ids to treat as failing',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  failingDbIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'middleware names to treat as rejecting the request',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  failingMiddleware?: string[];
}

export class SimulateEndpointDto {
  @ApiPropertyOptional({ type: SimulationTogglesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SimulationTogglesDto)
  toggles?: SimulationTogglesDto;

  @ApiPropertyOptional({
    description: 'Max transitive function expansion depth (default 8)',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxFunctionDepth?: number;
}
