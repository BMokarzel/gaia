import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, extractStringValue } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { LogNode } from '../../types/topology';

type LogLevel = LogNode['metadata']['level'];
type LogLibrary = LogNode['metadata']['library'];

const SLF4J_LEVELS: Record<string, LogLevel> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

const LOG4J_LEVELS: Record<string, LogLevel> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

export function extractJavaLogs(
  rootNode: SyntaxNode,
  filePath: string,
): LogNode[] {
  const logs: LogNode[] = [];

  for (const call of findAll(rootNode, 'method_invocation')) {
    const log = buildLogNode(call, filePath);
    if (log) logs.push(log);
  }

  return logs;
}

function buildLogNode(node: SyntaxNode, filePath: string): LogNode | null {
  const methodName = node.childForFieldName('name')?.text ?? '';
  const objectNode = node.childForFieldName('object');
  if (!objectNode) return null;

  const objText = objectNode.text;
  const loc = toLocation(node, filePath);

  // System.out.println / System.err.println
  if (/^System\.(out|err)$/.test(objText) && /^print/.test(methodName)) {
    const args = node.childForFieldName('arguments');
    const firstArg = args?.namedChildren[0];
    const message = firstArg ? extractMessage(firstArg) : undefined;
    const level: LogLevel = objText === 'System.err' ? 'error' : 'log';
    const id = nodeId('log', filePath, loc.line, `sysout:${message?.slice(0, 20) ?? ''}`);

    return {
      id,
      type: 'log',
      name: `${objText}.${methodName}`,
      location: loc,
      children: [],
      metadata: {
        level,
        library: 'console',
        message,
        hasStructuredData: false,
        includesTraceId: false,
        includesUserId: false,
        includesRequestId: false,
        category: level === 'error' ? 'error' : 'general',
      },
    };
  }

  // SLF4J / Logback: logger.info("msg", args)
  if (/^(log|logger|LOG|LOGGER)$/.test(objText) || /logger/i.test(objText)) {
    const level = SLF4J_LEVELS[methodName];
    if (!level) return null;

    const args = node.childForFieldName('arguments');
    const firstArg = args?.namedChildren[0];
    const message = firstArg ? extractMessage(firstArg) : undefined;

    const allArgsText = args?.text ?? '';
    const id = nodeId('log', filePath, loc.line, `slf4j:${methodName}:${message?.slice(0, 20) ?? ''}`);

    return {
      id,
      type: 'log',
      name: `${objText}.${methodName}`,
      location: loc,
      children: [],
      metadata: {
        level,
        library: 'custom',
        message,
        hasStructuredData: false,
        includesTraceId: /traceId|trace_id|traceID|spanId/.test(allArgsText),
        includesUserId: /userId|user_id|userID/.test(allArgsText),
        includesRequestId: /requestId|request_id|correlationId/.test(allArgsText),
        category: detectCategory(message ?? allArgsText, level),
      },
    };
  }

  // Log4j: LogManager.getLogger / log4j
  if (/log4j|Log4j/i.test(objText)) {
    const level = LOG4J_LEVELS[methodName];
    if (!level) return null;

    const args = node.childForFieldName('arguments');
    const message = args?.namedChildren[0] ? extractMessage(args.namedChildren[0]) : undefined;
    const id = nodeId('log', filePath, loc.line, `log4j:${methodName}:${message?.slice(0, 20) ?? ''}`);

    return {
      id,
      type: 'log',
      name: `${objText}.${methodName}`,
      location: loc,
      children: [],
      metadata: {
        level,
        library: 'log4js',
        message,
        hasStructuredData: false,
        includesTraceId: false,
        includesUserId: false,
        includesRequestId: false,
        category: detectCategory(message ?? '', level),
      },
    };
  }

  return null;
}

function extractMessage(node: SyntaxNode): string | undefined {
  if (node.type === 'string_literal') {
    return node.text.replace(/^["']|["']$/g, '').slice(0, 300);
  }
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
