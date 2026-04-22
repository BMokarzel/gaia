import { IsString, IsEnum, IsOptional, IsArray, ValidateNested, IsDefined } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ExportParamDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() in!: string;
  @ApiProperty() @IsString() type!: string;
  @ApiProperty() optional!: boolean;
}

class ExportResponseDto {
  @ApiProperty() status!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

class ExportDependencyDto {
  @ApiProperty() @IsString() kind!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) operations?: string[];
}

class EndpointContextDto {
  @ApiProperty() @IsString() serviceName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() serviceDescription?: string;
  @ApiProperty() @IsString() method!: string;
  @ApiProperty() @IsString() path!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() controller?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() humanName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() existingDescription?: string;
  @ApiProperty({ type: [ExportParamDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => ExportParamDto) params!: ExportParamDto[];
  @ApiProperty({ type: [ExportResponseDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => ExportResponseDto) responses!: ExportResponseDto[];
  @ApiProperty({ type: [Number] }) @IsArray() throwStatuses!: number[];
  @ApiProperty({ type: [ExportDependencyDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => ExportDependencyDto) dependencies!: ExportDependencyDto[];
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) flowSummary!: string[];
}

class ServiceContextDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() language!: string;
  @ApiProperty() @IsString() framework!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() humanName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() existingDescription?: string;
  @ApiProperty({ type: [Object] }) endpoints!: Array<{ method: string; path: string; humanName?: string; description?: string }>;
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) databases!: string[];
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) brokers!: string[];
}

export class ExportDescribeDto {
  @ApiProperty({ enum: ['endpoint', 'service'] })
  @IsEnum(['endpoint', 'service'])
  type!: 'endpoint' | 'service';

  @ApiProperty()
  @IsDefined()
  context!: EndpointContextDto | ServiceContextDto;
}

export type { EndpointContextDto, ServiceContextDto };
