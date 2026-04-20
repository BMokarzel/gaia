import { IsOptional, IsString, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ListTopologiesDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filtra por nome (substring, case-insensitive)' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: [String], description: 'Filtra por tags (AND)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
