import { Module } from '@nestjs/common';
import { ExtractionModule } from '../../extraction/extraction.module';
import { StorageModule } from '../../storage/storage.module';
import { EcosystemModule } from '../ecosystem/ecosystem.module';
import { TopologyController } from './topology.controller';
import { TopologyService } from './topology.service';
import { TOPOLOGY_SERVICE } from './tokens';

@Module({
  imports: [ExtractionModule, StorageModule, EcosystemModule],
  controllers: [TopologyController],
  providers: [
    TopologyService,
    { provide: TOPOLOGY_SERVICE, useClass: TopologyService },
  ],
})
export class TopologyModule {}
