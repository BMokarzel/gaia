import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { LogNode } from '../../types/topology';

type LogLevel = LogNode['metadata']['level'];

// Rust log macros: log::info!, log::error!, tracing::info!, tracing::error!, println!
const RUST_LOG_MACROS: Record<string, LogLevel> = {
  'log::trace': 'trace',
  'log::debug': 'debug',
  'log::info': 'info',
  'log::warn': 'warn',
  'log::error': 'error',
  'tracing::trace': 'trace',
  'tracing::debug': 'debug',
  'tracing::info': 'info',
  'tracing::warn': 'warn',
  'tracing::error': 'error',
  'slog::info': 'info',
  'slog::warn': 'warn',
  'slog::error': 'error',
  'slog::debug': 'debug',
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  println: 'log',
  eprintln: 'error',
};

export function extractRustLogs(
  rootNode: SyntaxNode,
  filePath: string,
): LogNode[] {
  const nodes: LogNode[] = [];

  for (const macro_ of findAll(rootNode, 'macro_invocation')) {
    const macroName = macro_.childForFieldName('macro')?.text
      ?? macro_.namedChildren[0]?.text
      ?? '';

    const level = RUST_LOG_MACROS[macroName];
    if (!level) continue;

    const library: LogNode['metadata']['library'] =
      macroName.startsWith('tracing::') ? 'custom'
      : macroName.startsWith('log::') ? 'custom'
      : macroName.startsWith('slog::') ? 'custom'
      : 'console';

    // Extract first string argument as message
    const tokenTree = macro_.childForFieldName('token_tree') ?? macro_.namedChildren[1];
    const message = tokenTree?.text
      .replace(/^\(|^\{/, '').replace(/\)$|\}$/, '')
      .match(/^["']?([^"',{]+)["']?/)?.[1]
      ?.trim()
      .slice(0, 200);

    const loc = toLocation(macro_, filePath);
    nodes.push({
      id: nodeId('log', filePath, loc.line, level),
      type: 'log', name: macroName,
      location: loc, children: [],
      metadata: {
        level,
        library,
        message,
        category: detectRustLogCategory(message),
        hasStructuredData: !!tokenTree?.text.includes('='),
        includesTraceId: !!tokenTree?.text.includes('trace_id'),
        includesUserId: !!tokenTree?.text.includes('user_id'),
        includesRequestId: !!tokenTree?.text.includes('request_id'),
      },
    });
  }

  return nodes;
}

function detectRustLogCategory(message: string | undefined): LogNode['metadata']['category'] {
  if (!message) return 'general';
  const m = message.toLowerCase();
  if (/error|fail|panic|unwrap/.test(m)) return 'error';
  if (/http|request|response|api|route/.test(m)) return 'request';
  if (/db|database|query|sql/.test(m)) return 'business_logic';
  if (/auth|login|token|jwt/.test(m)) return 'security';
  if (/start|stop|init|shutdown|ready/.test(m)) return 'lifecycle';
  return 'general';
}
