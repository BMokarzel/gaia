import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, extractStringValue } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { LogNode } from '../../types/topology';

type LogLevel = LogNode['metadata']['level'];
type LogLibrary = LogNode['metadata']['library'];

const LOGGING_LEVELS: Record<string, LogLevel> = {
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  warn: 'warn',
  error: 'error',
  critical: 'fatal',
  exception: 'error',
  log: 'log',
};

export function extractPythonLogs(
  rootNode: SyntaxNode,
  filePath: string,
): LogNode[] {
  const logs: LogNode[] = [];

  for (const call of findAll(rootNode, 'call')) {
    const log = buildLogNode(call, filePath);
    if (log) logs.push(log);
  }

  return logs;
}

function buildLogNode(node: SyntaxNode, filePath: string): LogNode | null {
  const fn = node.childForFieldName('function');
  if (!fn) return null;

  const loc = toLocation(node, filePath);

  // print(...) → console equivalent
  if (fn.type === 'identifier' && fn.text === 'print') {
    const args = node.childForFieldName('arguments');
    const firstArg = args?.namedChildren[0];
    const message = firstArg ? extractMessage(firstArg) : undefined;
    const id = nodeId('log', filePath, loc.line, `print:${message?.slice(0, 20) ?? ''}`);
    return {
      id,
      type: 'log',
      name: 'print',
      location: loc,
      children: [],
      metadata: {
        level: 'log',
        library: 'console',
        message,
        hasStructuredData: false,
        includesTraceId: false,
        includesUserId: false,
        includesRequestId: false,
        category: 'general',
      },
    };
  }

  // attribute call: logging.info, logger.debug, self.logger.error, etc.
  if (fn.type === 'attribute') {
    const obj = fn.childForFieldName('object');
    const attr = fn.childForFieldName('attribute');
    if (!obj || !attr) return null;

    const objText = obj.text;
    const methodName = attr.text;

    const level = LOGGING_LEVELS[methodName];
    if (!level) return null;

    // Only match known logger patterns
    const isLogger = /^(logging|logger|log|LOGGER|LOG|self\.log|self\.logger|app\.log|app\.logger)$/.test(objText) ||
      /logger/i.test(objText);
    if (!isLogger) return null;

    const args = node.childForFieldName('arguments');
    const firstArg = args?.namedChildren[0];
    const message = firstArg ? extractMessage(firstArg) : undefined;

    const allArgsText = args?.text ?? '';
    const library: LogLibrary = /structlog/i.test(objText) ? 'custom'
      : /loguru/i.test(objText) ? 'custom' : 'custom';

    const id = nodeId('log', filePath, loc.line, `py.log:${methodName}:${message?.slice(0, 20) ?? ''}`);

    return {
      id,
      type: 'log',
      name: `${objText}.${methodName}`,
      location: loc,
      children: [],
      metadata: {
        level,
        library,
        message,
        hasStructuredData: args?.namedChildren.some(n => n.type === 'dictionary') ?? false,
        includesTraceId: /trace_id|traceId|span_id/.test(allArgsText),
        includesUserId: /user_id|userId/.test(allArgsText),
        includesRequestId: /request_id|requestId|correlation_id/.test(allArgsText),
        category: detectCategory(message ?? allArgsText, level),
      },
    };
  }

  return null;
}

function extractMessage(node: SyntaxNode): string | undefined {
  if (node.type === 'string') return node.text.replace(/^f?['"`]{1,3}|['"`]{1,3}$/g, '').slice(0, 300);
  if (node.type === 'concatenated_string') return node.text.slice(0, 300);
  const strVal = extractStringValue(node);
  if (strVal) return strVal.slice(0, 300);
  return undefined;
}

function detectCategory(text: string, level: LogLevel): LogNode['metadata']['category'] {
  const lower = text.toLowerCase();
  if (level === 'error' || level === 'fatal') {
    if (/auth|unauthorized|forbidden/.test(lower)) return 'security';
    return 'error';
  }
  if (/request|incoming|received/.test(lower)) return 'request';
  if (/response|respond|reply/.test(lower)) return 'response';
  if (/error|exception|fail/.test(lower)) return 'error';
  if (/performance|duration|latency|elapsed/.test(lower)) return 'performance';
  if (/auth|login|logout|token|session/.test(lower)) return 'security';
  if (/start|stop|ready|boot|shutdown/.test(lower)) return 'lifecycle';
  return 'general';
}
