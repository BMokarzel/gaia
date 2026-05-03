import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { ChatRequestDto, ChatResponseDto } from './dto/chat-request.dto';

/**
 * Chat agent endpoint. Implements an Anthropic tool-use loop where the
 * agent can query topology data via {@link ./tools/topology-tools.ts}.
 *
 * Stateless — the client is responsible for keeping the message history.
 */
@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @ApiOperation({
    summary: 'Chat with the topology agent',
    description:
      'Runs an Anthropic tool-use loop bounded by 12 rounds. Tools query topology storage. ' +
      'Provide a `topologyId` to set a default context; the agent can override per-tool when needed.',
  })
  async post(@Body() dto: ChatRequestDto): Promise<ChatResponseDto> {
    return this.chat.chat(dto);
  }
}
