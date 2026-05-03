import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { TopologyModule } from '../topology/topology.module';
import { PrBotModule } from '../pr-bot/pr-bot.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [StorageModule, TopologyModule, PrBotModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
