import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { EcosystemService } from './ecosystem.service';

@ApiTags('ecosystem')
@Controller('ecosystem')
export class EcosystemController {
  constructor(private readonly service: EcosystemService) {}

  @Get()
  @ApiOperation({ summary: 'Retorna o índice global do ecossistema (ecosystem.json)' })
  getEcosystem() {
    return this.service.getEcosystem();
  }

  @Get('provisional')
  @ApiOperation({ summary: 'Retorna os nós externos não resolvidos (provisional.json)' })
  getProvisional() {
    return this.service.getProvisional();
  }
}
