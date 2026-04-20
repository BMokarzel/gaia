import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, memberChain } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { LogNode } from '../../types/topology';

type LogLevel = LogNode['metadata']['level'];

const JAVA_LOG_LEVELS: Record<string, LogLevel> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  fatal: 'fatal',
  severe: 'fatal',
  fine: 'debug',
  finer: 'trace',
  finest: 'trace',
};

const JAVA_LOG_OBJECTS = new Set([
  'log', 'LOG', 'logger', 'LOGGER', 'log4j', 'slf4j',
]);

export function extractJavaLogs(
  rootNode: SyntaxNode,
  filePath: string,
): LogNode[] {
  const nodes: LogNode[] = [];
  const calls = findAll(rootNode, 'method_invocation');

  for (const call of calls) {
    const objNode = call.childForFieldName('object');
    const methodNode = call.childForFieldName('name');
    if (!objNode || !methodNode) continue;

    const objText = objNode.text;
    const methodName = methodNode.text;

    // Only capture if object looks like a logger
    const isLogger = JAVA_LOG_OBJECTS.has(objText)
      || /log|logger/i.test(objText);
    if (!isLogger) continue;

    const level = JAVA_LOG_LEVELS[methodName];
    if (!level) continue;

    // Infer library from field type (best-effort from field name)
    let library: LogNode['metadata']['library'] = 'custom';
    if (/slf4j|logback/i.test(objText)) library = 'custom';

    const args = call.childForFieldName('arguments');
    const firstArg = args?.namedChildren[0];
    const message = firstArg?.text.replace(/^["']|["']$/g, '').slice(0, 200);

    const loc = toLocation(call, filePath);
    const id = nodeId('log', filePath, loc.line, level);

    nodes.push({
      id,
      type: 'log',
      name: `${objText}.${methodName}`,
      location: loc,
      children: [],
      metadata: {
        level,
        library,
        message,
        category: detectJavaLogCategory(message),
        hasStructuredData: false,
        includesTraceId: false,
        includesUserId: false,
        includesRequestId: false,
      },
    });
  }

  return nodes;
}

function detectJavaLogCategory(message: string | undefined): LogNode['metadata']['category'] {
  if (!message) return 'general';
  const m = message.toLowerCase();
  if (/error|exception|fail/.test(m)) return 'error';
  if (/http|request|response|api/.test(m)) return 'request';
  if (/db|database|query|sql|persist/.test(m)) return 'business_logic';
  if (/auth|login|token|jwt|security/.test(m)) return 'security';
  if (/start|stop|init|shutdown|boot|ready/.test(m)) return 'lifecycle';
  return 'general';
}
