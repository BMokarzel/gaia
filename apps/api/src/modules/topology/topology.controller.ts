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
import { SimulateEndpointDto } from './dto/simulate-endpoint.dto';

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

  @Get(':id/endpoints/:eid/flow')
  @ApiOperation({
    summary: 'Retorna apenas o endpoint solicitado e as funções alcançáveis a partir dele',
  })
  getEndpointFlow(@Param('id') id: string, @Param('eid') eid: string) {
    return this.service.getEndpointFlow(id, eid);
  }

  @Get(':id/source')
  @ApiOperation({
    summary: 'Lê um trecho de código fonte (apenas para topologias com source local)',
  })
  getSourceSnippet(
    @Param('id') id: string,
    @Query('file') file: string,
    @Query('line') line: string,
    @Query('context') context?: string,
  ) {
    const ctx = context !== undefined ? Number(context) : undefined;
    return this.service.getSourceSnippet(id, file, Number(line), ctx);
  }

  @Get(':id/docs/services/:serviceId')
  @ApiOperation({ summary: 'Gera documentação markdown para um service via LLM' })
  getServiceDoc(@Param('id') id: string, @Param('serviceId') serviceId: string) {
    return this.service.getServiceDoc(id, serviceId);
  }

  @Get(':id/docs/endpoints/:eid')
  @ApiOperation({ summary: 'Gera documentação markdown para um endpoint via LLM' })
  getEndpointDoc(@Param('id') id: string, @Param('eid') eid: string) {
    return this.service.getEndpointDoc(id, eid);
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

  // ── Fase 6: snapshots & diff ─────────────────────────────────────────────

  @Post(':id/reanalyze')
  @ApiOperation({ summary: 'Re-extrai a topologia usando o source guardado e arquiva o snapshot anterior' })
  reanalyze(@Param('id') id: string) {
    return this.service.reanalyze(id);
  }

  @Get(':id/snapshots')
  @ApiOperation({ summary: 'Lista snapshots históricos da topologia (current + history, mais recente primeiro)' })
  listSnapshots(@Param('id') id: string) {
    return this.service.listSnapshots(id);
  }

  @Get(':id/diff')
  @ApiOperation({ summary: 'Diff estrutural entre dois snapshots (use sha, "current" ou "HEAD")' })
  diff(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.diff(id, from, to);
  }

  // ── Fase 4: runtime metrics ─────────────────────────────────────────────

  @Get(':id/runtime')
  @ApiOperation({
    summary: 'Métricas runtime (mock determinístico). Aceita window (ms), seed (int), chaos (mult).',
  })
  getRuntimeMetrics(
    @Param('id') id: string,
    @Query('window') windowMs?: string,
    @Query('seed') seed?: string,
    @Query('chaos') chaos?: string,
  ) {
    const opts: { windowMs?: number; seed?: number; chaos?: number } = {};
    if (windowMs !== undefined) opts.windowMs = Number(windowMs);
    if (seed !== undefined) opts.seed = Number(seed);
    if (chaos !== undefined) opts.chaos = Number(chaos);
    return this.service.getRuntimeMetrics(id, opts);
  }

  // ── Fase 8: endpoint simulator ──────────────────────────────────────────

  @Post(':id/endpoints/:eid/simulate')
  @ApiOperation({
    summary:
      'Simula a execução de um endpoint, opcionalmente forçando falhas em externalCalls/dbOps/middlewares',
  })
  simulateEndpoint(
    @Param('id') id: string,
    @Param('eid') eid: string,
    @Body() dto: SimulateEndpointDto,
  ) {
    return this.service.simulateEndpoint(id, eid, {
      toggles: dto.toggles,
      maxFunctionDepth: dto.maxFunctionDepth,
    });
  }

}
