import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { LogNode } from '../../types/topology';

type LogLevel = LogNode['metadata']['level'];

const LOG_LEVELS: Record<string, LogLevel> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  fatal: 'fatal',
};

const LOG_RECEIVER_PATTERN = /^(log|logger|LOG|LOGGER|slf4j|log4j)/i;

export function extractKotlinLogs(
  rootNode: SyntaxNode,
  filePath: string,
): LogNode[] {
  const logs: LogNode[] = [];

  for (const node of findAll(rootNode, 'call_expression')) {
    const log = buildLogNode(node, filePath);
    if (log) logs.push(log);
  }

  return logs;
}

function buildLogNode(node: SyntaxNode, filePath: string): LogNode | null {
  // Callee must be a navigation_expression: logger.info(...)
  const calleeNode = node.namedChildren.find(c => c.type === 'navigation_expression');
  if (!calleeNode) return null;

  // navigation_expression: { receiver . method_name }
  const parts = calleeNode.namedChildren;
  const receiver = parts[0];
  const methodName = parts[parts.length - 1];

  if (!receiver || !methodName || methodName.type !== 'simple_identifier') return null;

  const receiverText = receiver.text;
  const method = methodName.text.toLowerCase();

  if (!LOG_RECEIVER_PATTERN.test(receiverText)) return null;

  const level = LOG_LEVELS[method];
  if (!level) return null;

  const valueArgs = node.namedChildren.find(c => c.type === 'value_arguments');
  const firstArg = valueArgs?.namedChildren.find(c => c.type === 'value_argument');
  const message = firstArg ? extractMessage(firstArg) : undefined;
  const allArgsText = valueArgs?.text ?? '';

  const loc = toLocation(node, filePath);
  const id = nodeId('log', filePath, loc.line, `kotlin:${method}:${message?.slice(0, 20) ?? ''}`);

  return {
    id,
    type: 'log',
    name: `${receiverText}.${method}`,
    location: loc,
    children: [],
    metadata: {
      level,
      library: 'custom',
      message,
      hasStructuredData: allArgsText.includes('{') || allArgsText.includes('mapOf'),
      includesTraceId: /traceId|trace_id|traceID|spanId/.test(allArgsText),
      includesUserId: /userId|user_id|userID/.test(allArgsText),
      includesRequestId: /requestId|request_id|correlationId/.test(allArgsText),
      category: detectCategory(message ?? allArgsText, level),
    },
  };
}

function extractMessage(node: SyntaxNode): string | undefined {
  const inner = node.type === 'value_argument' ? node.namedChildren[0] : node;
  if (!inner) return undefined;

  if (inner.type === 'string_literal') {
    return inner.text.replace(/^"+|"+$/g, '').slice(0, 300);
  }
  // string template: "text ${expr}"
  if (inner.type === 'string_template') {
    return inner.text.replace(/^"+|"+$/g, '').slice(0, 300);
  }
  return inner.text.slice(0, 100);
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
  if (/auth|login|logout|token|session/.test(lower)) return 'security';
  if (/start|stop|ready|boot|shutdown/.test(lower)) return 'lifecycle';
  return 'general';
}
