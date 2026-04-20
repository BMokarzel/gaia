import type { SyntaxNode } from '../../utils/ast-helpers';
import {
  findAll, toLocation, memberChain, callArguments, extractStringValue,
} from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { LogNode } from '../../types/topology';

type LogLevel = LogNode['metadata']['level'];
type LogLibrary = LogNode['metadata']['library'];
type LogCategory = LogNode['metadata']['category'];

/** Mapeamento de método → nível de log */
const LOG_LEVELS: Record<string, LogLevel> = {
  trace: 'trace',
  debug: 'debug',
  verbose: 'debug',
  info: 'info',
  log: 'log',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  fatal: 'fatal',
  critical: 'fatal',
};

/** Objetos/prefixos que indicam uma biblioteca de log */
interface LogPattern {
  pattern: RegExp;
  library: LogLibrary;
}

const LOG_PATTERNS: LogPattern[] = [
  { pattern: /\bconsole\b/, library: 'console' },
  { pattern: /\blogger\b/i, library: 'custom' },
  { pattern: /\bwins?ton\b/i, library: 'winston' },
  { pattern: /\bpino\b/i, library: 'pino' },
  { pattern: /\bbunyan\b/i, library: 'bunyan' },
  { pattern: /\blog4[jJ]s?\b/, library: 'log4js' },
  { pattern: /\bdebug\b/, library: 'debug' },
  { pattern: /\bthis\.log/, library: 'custom' },
  { pattern: /\bthis\.logger\b/, library: 'custom' },
];

/**
 * Extrai chamadas de log de um arquivo TypeScript/JavaScript.
 * Detecta: console.log/warn/error, winston, pino, bunyan, NestJS Logger
 */
export function extractLogs(
  rootNode: SyntaxNode,
  filePath: string,
): LogNode[] {
  const logs: LogNode[] = [];

  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    // Só interessa member expressions: console.log, logger.info, etc.
    if (fn.type !== 'member_expression') continue;

    const chain = memberChain(fn);
    if (chain.length < 2) continue;

    const method = chain[chain.length - 1];
    const objPath = chain.slice(0, -1).join('.');

    const level = LOG_LEVELS[method];
    if (!level) continue;

    // Detecta a biblioteca
    const library = detectLibrary(objPath);

    const args = call.childForFieldName('arguments');
    const argNodes = args?.namedChildren ?? [];

    // Tenta extrair a mensagem de log (primeiro argumento string)
    const firstArg = argNodes[0];
    let message: string | undefined;
    if (firstArg) {
      const strVal = extractStringValue(firstArg);
      if (strVal) {
        message = strVal.slice(0, 300);
      } else if (firstArg.type === 'template_string') {
        message = firstArg.text.slice(1, -1).slice(0, 300); // Remove backticks
      }
    }

    // Detecta dados estruturados (objeto como argumento)
    const hasStructuredData = argNodes.some(
      n => n.type === 'object' || n.type === 'identifier' && n.text !== 'null',
    );

    // Detecta contexto (campos passados)
    const context: string[] = [];
    for (const arg of argNodes) {
      if (arg.type === 'identifier') context.push(arg.text);
    }

    // Verifica se inclui traceId, userId, requestId
    const allArgsText = argNodes.map(n => n.text).join(' ');
    const includesTraceId = /trace[Ii]d|traceID|trace_id|spanId/.test(allArgsText);
    const includesUserId = /user[Ii]d|userId|user_id/.test(allArgsText);
    const includesRequestId = /req[Ii]d|request[Ii]d|correlationId/.test(allArgsText);

    const category = detectLogCategory(message ?? allArgsText, level);
    const loc = toLocation(call, filePath);
    const id = nodeId('log', filePath, loc.line, `${method}:${message?.slice(0, 20) ?? ''}`);

    logs.push({
      id,
      type: 'log',
      name: `${objPath}.${method}`,
      location: loc,
      children: [],
      metadata: {
        level,
        library,
        message,
        hasStructuredData,
        context: context.length > 0 ? context : undefined,
        includesTraceId,
        includesUserId,
        includesRequestId,
        category,
      },
    });
  }

  return logs;
}

function detectLibrary(objPath: string): LogLibrary {
  for (const { pattern, library } of LOG_PATTERNS) {
    if (pattern.test(objPath)) return library;
  }
  return 'custom';
}

function detectLogCategory(text: string, level: LogLevel): LogCategory {
  const lower = text.toLowerCase();

  if (level === 'error' || level === 'fatal') {
    if (lower.includes('auth') || lower.includes('unauthorized') || lower.includes('forbidden')) {
      return 'security';
    }
    return 'error';
  }

  if (/request|incoming|received|req/.test(lower)) return 'request';
  if (/response|respond|reply|res/.test(lower)) return 'response';
  if (/error|exception|fail|crash/.test(lower)) return 'error';
  if (/performance|duration|latency|took|elapsed|ms/.test(lower)) return 'performance';
  if (/auth|login|logout|token|jwt|session|permission|role/.test(lower)) return 'security';
  if (/start|stop|ready|boot|shutdown|connect|disconnect/.test(lower)) return 'lifecycle';
  if (/metric|trace|span|otel/.test(lower)) return 'performance';

  return 'general';
}
