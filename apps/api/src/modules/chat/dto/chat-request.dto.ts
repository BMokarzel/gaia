import { IsArray, IsOptional, IsString, ValidateNested, IsIn, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ChatMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @ApiProperty({ description: 'Plain text content. Tool turns are reconstructed server-side.' })
  @IsString()
  content!: string;
}

export class ChatRequestDto {
  @ApiProperty({ type: [ChatMessageDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  @ApiProperty({ required: false, description: 'Optional default topology context for tool calls.' })
  @IsOptional()
  @IsString()
  topologyId?: string;
}

export interface ToolCallTraceEntry {
  tool: string;
  input: unknown;
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface ChatResponseDto {
  reply: string;
  trace: ToolCallTraceEntry[];
  /** Model-reported stop reason (`end_turn`, `max_tokens`, `stop_sequence`) */
  stopReason?: string;
}
