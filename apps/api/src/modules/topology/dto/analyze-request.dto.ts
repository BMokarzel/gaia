import { IsString, IsOptional, IsEnum, IsArray, IsBoolean, ValidateNested, IsDefined } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class LocalSourceDto {
  @ApiProperty({ enum: ['local'] })
  @IsString()
  kind!: 'local';

  @ApiProperty({ description: 'Caminho absoluto ou relativo no sistema de arquivos local' })
  @IsString()
  path!: string;
}

class GitSourceDto {
  @ApiProperty({ enum: ['git'] })
  @IsString()
  kind!: 'git';

  @ApiProperty({ description: 'URL do repositório git' })
  @IsString()
  url!: string;

  @ApiPropertyOptional({ description: 'Branch a clonar (default: branch padrão do repo)' })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({ description: 'Commit SHA ou tag para checkout após clone' })
  @IsOptional()
  @IsString()
  ref?: string;
}

class AnalysisOptionsDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  skipTests?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  includeFrontend?: boolean;
}

export class AnalyzeRequestDto {
  @ApiProperty({ description: 'Fonte de extração (local | git)' })
  @IsDefined()
  @ValidateNested()
  @Type(() => LocalSourceDto)
  source!: LocalSourceDto | GitSourceDto;

  @ApiPropertyOptional({ description: 'Nome da topologia. Default: derivado da fonte' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => AnalysisOptionsDto)
  options?: AnalysisOptionsDto;

  @ApiPropertyOptional({
    enum: ['persist', 'delete'],
    description: 'Política de clone. Sobrescreve CLONE_POLICY do env. Padrão: delete',
  })
  @IsOptional()
  @IsEnum(['persist', 'delete'])
  clonePolicy?: 'persist' | 'delete';
}
