import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { LogNode } from '../../types/topology';

type LogLevel = LogNode['metadata']['level'];

// ILogger<T>.LogInformation() / Serilog Log.Information() / NLog logger.Info()
const CSHARP_LOG_METHODS: Record<string, LogLevel> = {
  LogTrace: 'trace', LogDebug: 'debug', LogInformation: 'info',
  LogWarning: 'warn', LogError: 'error', LogCritical: 'fatal',
  // Serilog
  Verbose: 'trace', Debug: 'debug', Information: 'info',
  Warning: 'warn', Error: 'error', Fatal: 'fatal',
  // NLog
  Trace: 'trace', Info: 'info', Warn: 'warn',
};

const CSHARP_LOG_OBJECTS = new Set([
  '_logger', 'logger', 'Logger', '_log', 'log', 'Log',
  'Log4Net', '_loggingService',
]);

export function extractCSharpLogs(
  rootNode: SyntaxNode,
  filePath: string,
): LogNode[] {
  const nodes: LogNode[] = [];

  for (const call of findAll(rootNode, 'invocation_expression')) {
    const expr = call.childForFieldName('expression');
    if (!expr || expr.type !== 'member_access_expression') continue;

    const obj = expr.childForFieldName('expression')?.text ?? '';
    const method = expr.childForFieldName('name')?.text ?? '';

    const level = CSHARP_LOG_METHODS[method];
    if (!level) continue;

    const isLogger = CSHARP_LOG_OBJECTS.has(obj) || /log|logger/i.test(obj);
    if (!isLogger) continue;

    const library: LogNode['metadata']['library'] = 'custom';

    const argList = call.childForFieldName('argument_list');
    const firstArg = argList?.namedChildren.find(a => a.type === 'argument');
    const argExpr = firstArg?.childForFieldName('expression') ?? firstArg;
    const message = argExpr?.text.replace(/^"|"$/g, '').replace(/^\$?@?"/, '').slice(0, 200);

    const loc = toLocation(call, filePath);
    nodes.push({
      id: nodeId('log', filePath, loc.line, level),
      type: 'log', name: `${obj}.${method}`,
      location: loc, children: [],
      metadata: {
        level, library, message,
        category: detectCSharpLogCategory(message),
        hasStructuredData: !!argList?.text.includes('{'),
        includesTraceId: !!argList?.text.includes('TraceId') || !!argList?.text.includes('traceId'),
        includesUserId: !!argList?.text.includes('UserId') || !!argList?.text.includes('userId'),
        includesRequestId: !!argList?.text.includes('RequestId') || !!argList?.text.includes('requestId'),
      },
    });
  }

  return nodes;
}

function detectCSharpLogCategory(message: string | undefined): LogNode['metadata']['category'] {
  if (!message) return 'general';
  const m = message.toLowerCase();
  if (/error|exception|fail/.test(m)) return 'error';
  if (/http|request|response|api|endpoint/.test(m)) return 'request';
  if (/db|database|sql|entity|migration/.test(m)) return 'business_logic';
  if (/auth|login|token|jwt|identity/.test(m)) return 'security';
  if (/start|stop|init|shutdown|host|service/.test(m)) return 'lifecycle';
  return 'general';
}
