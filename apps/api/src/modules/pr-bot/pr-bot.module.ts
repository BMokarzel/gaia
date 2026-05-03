import { Module } from '@nestjs/common';
import { ExtractionModule } from '../../extraction/extraction.module';
import { StorageModule } from '../../storage/storage.module';
import { PrBotService } from './pr-bot.service';

/**
 * Glue module for the PR bot. The actual webhook entrypoint lives in WebhookModule —
 * this module only exposes the service for re-use (e.g. a manual `POST /pr-bot/run`
 * could be added later for backfilling old PRs).
 */
@Module({
  imports: [ExtractionModule, StorageModule],
  providers: [PrBotService],
  exports: [PrBotService],
})
export class PrBotModule {}
