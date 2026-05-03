// ============================================================
// LLM caller abstraction (shared by enrichment + doc-generator)
// ------------------------------------------------------------
// Uses Anthropic SDK when ANTHROPIC_API_KEY is set; otherwise
// falls back to the `claude -p` CLI (already authenticated via
// OAuth). Kept tiny and dependency-light so other analysis
// modules can import it without dragging in the enrichment
// pipeline.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { spawnSync } from 'child_process';

export type LLMCaller = (prompt: string, model: string) => Promise<string>;

export function makeLLMCaller(apiKey?: string): LLMCaller {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;

  if (key) {
    const client = new Anthropic({ apiKey: key });
    return async (prompt, model) => {
      const res = await client.messages.create({
        model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      return res.content[0].type === 'text' ? res.content[0].text : '';
    };
  }

  // Fallback: claude CLI subprocess (OAuth session). Keeps the engine
  // usable in dev without requiring an explicit API key in env.
  return async (prompt, _model) => {
    const result = spawnSync('claude', ['-p'], {
      input: prompt,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 4,
      shell: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || 'claude CLI failed');
    return result.stdout.trim();
  };
}
