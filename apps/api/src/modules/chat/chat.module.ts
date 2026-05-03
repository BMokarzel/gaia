import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { TopologyModule } from '../topology/topology.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [StorageModule, TopologyModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
