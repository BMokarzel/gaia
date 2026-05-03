import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { TOPOLOGY_STORAGE } from '../../storage/tokens';
import type { ITopologyStorageRepository } from '../../storage/interfaces/topology-storage.interface';
import { TOPOLOGY_SERVICE } from '../topology/tokens';
import type { ITopologyService } from '../topology/interfaces/topology-service.interface';
import type { ChatRequestDto, ChatResponseDto, ToolCallTraceEntry } from './dto/chat-request.dto';
import { findTool, toolSchemas, type ToolContext } from './tools/topology-tools';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_ROUNDS = 12;
const MAX_OUTPUT_TOKENS = 4096;

const SYSTEM_PROMPT = `You are an assistant for the "topology" project — a tool that analyzes codebases and produces a SystemTopology graph (services, endpoints, databases, edges, ownership).

You have tools that query analyzed topologies. Always prefer using a tool over speculating. When the user asks about specific services, endpoints, flows, or recent changes, call the appropriate tool first.

Be concise. Lead with the answer; cite ids and paths verbatim. When you receive tool output, synthesize it — don't just dump JSON. If a request needs a topology id and none is in context, list available topologies and ask the user to choose.`;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly client?: Anthropic;

  constructor(
    @Inject(TOPOLOGY_STORAGE) private readonly storage: ITopologyStorageRepository,
    @Inject(TOPOLOGY_SERVICE) private readonly topology: ITopologyService,
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) this.client = new Anthropic({ apiKey });
  }

  /**
   * Runs the Anthropic tool-use loop. Each iteration:
   *   1. Send messages + tool schemas to the model.
   *   2. If `stop_reason === 'tool_use'`, dispatch each `tool_use` block via the tool registry,
   *      append the assistant message + tool_result blocks, and loop.
   *   3. Otherwise return the concatenated text content.
   *
   * Bounded by {@link MAX_TOOL_ROUNDS} so a misbehaving model can't loop forever.
   */
  async chat(dto: ChatRequestDto): Promise<ChatResponseDto> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Chat is unavailable — set ANTHROPIC_API_KEY to enable the chat agent.',
      );
    }

    const ctx: ToolContext = {
      storage: this.storage,
      topology: this.topology,
      defaultTopologyId: dto.topologyId,
    };

    // Convert simple string messages from the client into the SDK content-block format.
    const messages: Anthropic.MessageParam[] = dto.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const trace: ToolCallTraceEntry[] = [];
    let stopReason: string | undefined;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        tools: toolSchemas(),
        messages,
      });

      stopReason = response.stop_reason ?? undefined;

      if (response.stop_reason !== 'tool_use') {
        const reply = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim();
        return { reply, trace, stopReason };
      }

      // Append the assistant turn (with its tool_use blocks) before responding.
      messages.push({ role: 'assistant', content: response.content });

      // Execute every tool_use block in this turn and gather tool_results.
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const entry: ToolCallTraceEntry = {
          tool: block.name,
          input: block.input,
          durationMs: 0,
        };
        const started = Date.now();
        try {
          const tool = findTool(block.name);
          if (!tool) throw new Error(`Unknown tool: ${block.name}`);
          const output = await tool.handle(block.input, ctx);
          entry.output = output;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(output ?? null),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          entry.error = message;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
            content: message,
          });
          this.logger.warn(`Tool "${block.name}" failed: ${message}`);
        } finally {
          entry.durationMs = Date.now() - started;
          trace.push(entry);
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }

    // Loop budget exhausted — return whatever trace we have.
    return {
      reply: '⚠ Tool-use loop exceeded its budget. Try a more focused question.',
      trace,
      stopReason: 'max_tool_rounds',
    };
  }
}
