import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, HttpCode, HttpStatus, Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TOPOLOGY_SERVICE } from './tokens';
import type { ITopologyService } from './interfaces/topology-service.interface';
import { AnalyzeRequestDto } from './dto/analyze-request.dto';
import { UpdateTopologyDto } from './dto/update-topology.dto';
import { ListTopologiesDto } from './dto/list-topologies.dto';
import { MergeDecisionDto } from './dto/merge-decision.dto';
import { ExportDescribeDto } from './dto/export-describe.dto';

@ApiTags('topologies')
@Controller('topologies')
export class TopologyController {
  constructor(
    @Inject(TOPOLOGY_SERVICE) private readonly service: ITopologyService,
  ) {}

  @Post('analyze')
  @ApiOperation({ summary: 'Extrai uma topologia. Retorna pendingMerges se houver decisões pendentes.' })
  analyze(@Body() dto: AnalyzeRequestDto) {
    return this.service.analyze(dto);
  }

  @Post('export/describe')
  @ApiOperation({ summary: 'Gera descrição rica via LLM para exportação (draw.io + documento)' })
  describe(@Body() dto: ExportDescribeDto) {
    return this.service.describe(dto);
  }

  @Post('analyze/merge-decision')
  @ApiOperation({ summary: 'Submete decisões de merge para uma extração em andamento' })
  resolveMergeDecisions(@Body() dto: MergeDecisionDto) {
    return this.service.resolveMergeDecisions(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista topologias persistidas' })
  list(@Query() dto: ListTopologiesDto) {
    return this.service.list(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retorna uma topologia completa por ID' })
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza metadados (name, tags)' })
  update(@Param('id') id: string, @Body() dto: UpdateTopologyDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove uma topologia' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

}
