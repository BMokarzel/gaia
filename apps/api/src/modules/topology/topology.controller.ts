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

@ApiTags('topologies')
@Controller('topologies')
export class TopologyController {
  constructor(
    @Inject(TOPOLOGY_SERVICE) private readonly service: ITopologyService,
  ) {}

  @Post('analyze')
  @ApiOperation({ summary: 'Extrai e persiste uma topologia a partir de uma fonte' })
  analyze(@Body() dto: AnalyzeRequestDto) {
    return this.service.analyze(dto);
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

  @Get(':id/services')
  @ApiOperation({ summary: 'Lista os ServiceNodes de uma topologia' })
  getServices(@Param('id') id: string) {
    return this.service.getServices(id);
  }
}
