import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, memberChain } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { LogNode } from '../../types/topology';

type LogLevel = LogNode['metadata']['level'];

const PYTHON_LOG_LEVELS: Record<string, LogLevel> = {
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  warn: 'warn',
  error: 'error',
  critical: 'fatal',
  exception: 'error',
  fatal: 'fatal',
  msg: 'info',
  bind: 'info',
};

const PYTHON_LOG_OBJECTS = new Set([
  'logging', 'logger', 'log', 'LOG', 'LOGGER',
  'app', 'structlog', 'loguru',
]);

export function extractPythonLogs(
  rootNode: SyntaxNode,
  filePath: string,
): LogNode[] {
  const nodes: LogNode[] = [];
  const calls = findAll(rootNode, 'call');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    let objectName: string | null = null;
    let methodName: string;

    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object');
      const attr = fn.childForFieldName('attribute');
      if (!obj || !attr) continue;
      objectName = obj.text;
      methodName = attr.text;
    } else {
      continue; // Skip bare function calls
    }

    const level = PYTHON_LOG_LEVELS[methodName];
    if (!level) continue;

    const isLogger = PYTHON_LOG_OBJECTS.has(objectName)
      || /log|logger/i.test(objectName);
    if (!isLogger) continue;

    const args = call.childForFieldName('arguments');
    const firstArg = args?.namedChildren[0];
    const message = firstArg?.text.replace(/^["'`f]|["'`]$/g, '').slice(0, 200);

    const library: LogNode['metadata']['library'] =
      objectName === 'logging' ? 'custom'
      : /structlog/i.test(objectName) ? 'custom'
      : /loguru/i.test(objectName) ? 'custom'
      : 'custom';

    const loc = toLocation(call, filePath);
    const id = nodeId('log', filePath, loc.line, level);

    nodes.push({
      id,
      type: 'log',
      name: `${objectName}.${methodName}`,
      location: loc,
      children: [],
      metadata: {
        level,
        library,
        message,
        category: detectPythonLogCategory(message),
        hasStructuredData: false,
        includesTraceId: false,
        includesUserId: false,
        includesRequestId: false,
      },
    });
  }

  return nodes;
}

function detectPythonLogCategory(message: string | undefined): LogNode['metadata']['category'] {
  if (!message) return 'general';
  const m = message.toLowerCase();
  if (/error|exception|traceback|fail/.test(m)) return 'error';
  if (/http|request|response|api|route/.test(m)) return 'request';
  if (/db|database|query|sql|orm/.test(m)) return 'business_logic';
  if (/auth|login|token|jwt|permission/.test(m)) return 'security';
  if (/start|stop|init|shutdown|ready|boot/.test(m)) return 'lifecycle';
  return 'general';
}
