import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, memberChain } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { LogNode } from '../../types/topology';

type LogLevel = LogNode['metadata']['level'];

const GO_LOG_LEVELS: Record<string, LogLevel> = {
  debug: 'debug',
  Debug: 'debug',
  Debugf: 'debug',
  Debugw: 'debug',
  Debugln: 'debug',
  info: 'info',
  Info: 'info',
  Infof: 'info',
  Infow: 'info',
  Infoln: 'info',
  warn: 'warn',
  Warn: 'warn',
  Warnf: 'warn',
  Warnw: 'warn',
  Warning: 'warn',
  Warningf: 'warn',
  error: 'error',
  Error: 'error',
  Errorf: 'error',
  Errorw: 'error',
  Errorln: 'error',
  fatal: 'fatal',
  Fatal: 'fatal',
  Fatalf: 'fatal',
  Fatalln: 'fatal',
  panic: 'fatal',
  Panic: 'fatal',
  Panicf: 'fatal',
  Print: 'log',
  Printf: 'log',
  Println: 'log',
};

const GO_LOG_LIBRARIES: Record<string, LogNode['metadata']['library']> = {
  log: 'custom',
  zap: 'custom',
  logger: 'custom',
  Logger: 'custom',
  sugar: 'custom',
  logrus: 'custom',
  log15: 'custom',
  slog: 'custom',
};

export function extractGoLogs(
  rootNode: SyntaxNode,
  filePath: string,
): LogNode[] {
  const nodes: LogNode[] = [];
  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    const chain = fn.type === 'selector_expression'
      ? memberChain(fn)
      : fn.text ? [fn.text] : [];

    if (chain.length === 0) continue;

    const methodName = chain[chain.length - 1];
    const level = GO_LOG_LEVELS[methodName];
    if (!level) continue;

    const objectName = chain.length > 1 ? chain[chain.length - 2].toLowerCase() : '';

    // Only capture if root object looks like a logger
    const isLogger = chain.length === 1 // stdlib log.Printf directly
      || Object.keys(GO_LOG_LIBRARIES).some(l => objectName.includes(l))
      || /log|logger|zap|logrus|slog/i.test(objectName);

    if (!isLogger) continue;

    const library: LogNode['metadata']['library'] =
      Object.keys(GO_LOG_LIBRARIES).find(l => objectName.includes(l)) !== undefined
        ? 'custom'
        : 'console';

    const args = call.childForFieldName('arguments');
    const firstArg = args?.namedChildren[0];
    const message = firstArg?.text.replace(/^["'`]|["'`]$/g, '').slice(0, 200);

    const loc = toLocation(call, filePath);
    const id = nodeId('log', filePath, loc.line, level);

    nodes.push({
      id,
      type: 'log',
      name: `${objectName ? objectName + '.' : ''}${methodName}`,
      location: loc,
      children: [],
      metadata: {
        level,
        library,
        message,
        category: detectGoLogCategory(message),
        hasStructuredData: false,
        includesTraceId: false,
        includesUserId: false,
        includesRequestId: false,
      },
    });
  }

  return nodes;
}

function detectGoLogCategory(message: string | undefined): LogNode['metadata']['category'] {
  if (!message) return 'general';
  const m = message.toLowerCase();
  if (/error|fail|exception|panic/.test(m)) return 'error';
  if (/http|request|response|api|route/.test(m)) return 'request';
  if (/db|database|query|sql/.test(m)) return 'business_logic';
  if (/auth|login|token|jwt/.test(m)) return 'security';
  if (/start|stop|init|shutdown|ready/.test(m)) return 'lifecycle';
  return 'general';
}
