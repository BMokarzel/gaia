import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, extractStringValue } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { LogNode } from '../../types/topology';

type LogLevel = LogNode['metadata']['level'];
type LogLibrary = LogNode['metadata']['library'];

/** Standard library log package methods */
const STD_LOG_LEVELS: Record<string, LogLevel> = {
  Print: 'log',
  Println: 'log',
  Printf: 'log',
  Fatal: 'fatal',
  Fatalln: 'fatal',
  Fatalf: 'fatal',
  Panic: 'fatal',
  Panicln: 'fatal',
  Panicf: 'fatal',
};

/** logrus / zap / zerolog methods */
const STRUCTURED_LOG_LEVELS: Record<string, LogLevel> = {
  Trace: 'trace',
  Debug: 'debug',
  Info: 'info',
  Warn: 'warn',
  Warning: 'warn',
  Error: 'error',
  Fatal: 'fatal',
  Panic: 'fatal',
  // methods
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  fatal: 'fatal',
  panic: 'fatal',
};

export function extractGoLogs(
  rootNode: SyntaxNode,
  filePath: string,
): LogNode[] {
  const logs: LogNode[] = [];

  for (const call of findAll(rootNode, 'call_expression')) {
    const log = buildLogNode(call, filePath);
    if (log) logs.push(log);
  }

  return logs;
}

function buildLogNode(node: SyntaxNode, filePath: string): LogNode | null {
  const fn = node.childForFieldName('function');
  if (!fn) return null;

  const loc = toLocation(node, filePath);

  // Selector expression: package.Method or obj.Method
  if (fn.type === 'selector_expression') {
    const obj = fn.childForFieldName('operand');
    const field = fn.childForFieldName('field');
    if (!obj || !field) return null;

    const objText = obj.text;
    const methodName = field.text;

    // Standard log: log.Println, log.Printf, log.Fatal
    if (objText === 'log' || objText === 'l' || objText === 'Log') {
      const level = STD_LOG_LEVELS[methodName];
      if (!level) return null;

      const args = node.childForFieldName('arguments');
      const firstArg = args?.namedChildren[0];
      const message = firstArg ? extractGoMessage(firstArg) : undefined;

      const id = nodeId('log', filePath, loc.line, `log.${methodName}:${message?.slice(0, 20) ?? ''}`);
      return {
        id,
        type: 'log',
        name: `log.${methodName}`,
        location: loc,
        children: [],
        metadata: {
          level,
          library: 'custom',
          message,
          hasStructuredData: false,
          includesTraceId: false,
          includesUserId: false,
          includesRequestId: false,
          category: detectCategory(message ?? '', level),
        },
      };
    }

    // logrus chained: logrus.WithError(err).Error(...) / logrus.WithField(...).Info(...)
    // In this case obj is a call_expression like logrus.WithError(err)
    if (obj.type === 'call_expression') {
      const innerFn = obj.childForFieldName('function');
      let isLogrusChain = false;
      if (innerFn?.type === 'selector_expression') {
        const innerObj = innerFn.childForFieldName('operand');
        const innerField = innerFn.childForFieldName('field');
        if (innerObj && /^(logrus|log|logger|Logger|zap|sugar|zerolog|slog|l)$/.test(innerObj.text) ||
            (innerObj && (/logger/i.test(innerObj.text) || /log$/i.test(innerObj.text)))) {
          isLogrusChain = true;
        }
        // also handle deeper chains like logrus.WithField(...).WithError(...).Error(...)
        if (innerObj?.type === 'call_expression') {
          isLogrusChain = true;
        }
      }
      if (isLogrusChain) {
        const level = STRUCTURED_LOG_LEVELS[methodName];
        if (level) {
          const args = node.childForFieldName('arguments');
          const firstArg = args?.namedChildren[0];
          const message = firstArg ? extractGoMessage(firstArg) : undefined;
          const allArgsText = args?.text ?? '';
          const id = nodeId('log', filePath, loc.line, `chain.${methodName}:${message?.slice(0, 20) ?? ''}`);
          return {
            id,
            type: 'log',
            name: `logrus.${methodName}`,
            location: loc,
            children: [],
            metadata: {
              level,
              library: 'custom' as LogLibrary,
              message,
              hasStructuredData: true,
              includesTraceId: /traceId|trace_id|TraceID|spanId/.test(allArgsText),
              includesUserId: /userId|user_id|UserID/.test(allArgsText),
              includesRequestId: /requestId|request_id|RequestID|correlationId/.test(allArgsText),
              category: detectCategory(message ?? allArgsText, level),
            },
          };
        }
      }
    }

    // logrus: logrus.Info / log.WithFields(logrus.Fields{}).Info
    if (/^(logrus|log|logger|Logger|zap|sugar|zerolog|slog|l)$/.test(objText) ||
        /logger/i.test(objText) || /log$/i.test(objText)) {
      const level = STRUCTURED_LOG_LEVELS[methodName];
      if (!level) return null;

      const args = node.childForFieldName('arguments');
      const firstArg = args?.namedChildren[0];
      const message = firstArg ? extractGoMessage(firstArg) : undefined;
      const allArgsText = args?.text ?? '';

      const library = detectLibrary(objText);
      const id = nodeId('log', filePath, loc.line, `${objText}.${methodName}:${message?.slice(0, 20) ?? ''}`);

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
          hasStructuredData: args?.namedChildren.some(n =>
            n.type === 'composite_literal' || n.type === 'map_type'
          ) ?? false,
          includesTraceId: /traceId|trace_id|TraceID|spanId/.test(allArgsText),
          includesUserId: /userId|user_id|UserID/.test(allArgsText),
          includesRequestId: /requestId|request_id|RequestID|correlationId/.test(allArgsText),
          category: detectCategory(message ?? allArgsText, level),
        },
      };
    }

    // fmt.Printf, fmt.Println — treat as console log
    if (objText === 'fmt' && /^Print|Println|Printf$/.test(methodName)) {
      const args = node.childForFieldName('arguments');
      const firstArg = args?.namedChildren[0];
      const message = firstArg ? extractGoMessage(firstArg) : undefined;
      const id = nodeId('log', filePath, loc.line, `fmt.${methodName}:${message?.slice(0, 20) ?? ''}`);

      return {
        id,
        type: 'log',
        name: `fmt.${methodName}`,
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
  }

  return null;
}

function extractGoMessage(node: SyntaxNode): string | undefined {
  if (node.type === 'interpreted_string_literal' || node.type === 'raw_string_literal') {
    return node.text.replace(/^["`]|["`]$/g, '').slice(0, 300);
  }
  const strVal = extractStringValue(node);
  if (strVal) return strVal.slice(0, 300);
  return undefined;
}

function detectLibrary(objText: string): LogLibrary {
  if (/logrus/i.test(objText)) return 'custom';
  if (/zap|sugar/i.test(objText)) return 'custom';
  if (/zerolog/i.test(objText)) return 'custom';
  if (/slog/i.test(objText)) return 'custom';
  return 'custom';
}

function detectCategory(text: string, level: LogLevel): LogNode['metadata']['category'] {
  const lower = text.toLowerCase();
  if (level === 'error' || level === 'fatal') {
    if (/auth|unauthorized|forbidden/.test(lower)) return 'security';
    return 'error';
  }
  if (/request|incoming|received/.test(lower)) return 'request';
  if (/response|respond|reply/.test(lower)) return 'response';
  if (/error|fail/.test(lower)) return 'error';
  if (/duration|latency|elapsed|ms/.test(lower)) return 'performance';
  if (/auth|login|token|session/.test(lower)) return 'security';
  if (/start|stop|ready|shutdown/.test(lower)) return 'lifecycle';
  return 'general';
}
