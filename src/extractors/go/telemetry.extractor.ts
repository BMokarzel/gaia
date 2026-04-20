import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, memberChain } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { TelemetryNode } from '../../types/topology';

type SDK = TelemetryNode['metadata']['sdk'];

const TRACER_PATTERNS = [/tracer|otel|opentelemetry|tracing/i];
const METER_PATTERNS = [/meter|metrics|prometheus|prom/i];
const SPAN_METHODS = new Set(['Start', 'StartSpan', 'StartSpanWithRemoteParent', 'startSpan']);
const METRIC_METHODS = new Set(['NewCounter', 'NewGauge', 'NewHistogram', 'NewSummary',
  'Inc', 'Add', 'Observe', 'Set', 'With', 'MustRegister']);

export function extractGoTelemetry(
  rootNode: SyntaxNode,
  filePath: string,
): TelemetryNode[] {
  const nodes: TelemetryNode[] = [];

  for (const call of findAll(rootNode, 'call_expression')) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    const chain = fn.type === 'selector_expression' ? memberChain(fn) : [fn.text];
    if (chain.length < 2) continue;

    const method = chain[chain.length - 1];
    const objPath = chain.slice(0, -1).join('.');

    const sdk = detectSDK(objPath, method);
    if (!sdk) continue;

    const args = call.childForFieldName('arguments');
    const firstArg = args?.namedChildren.find(a => a.type !== 'comment');

    let kind: TelemetryNode['metadata']['kind'] = 'span';
    let name = 'unnamed';

    if (SPAN_METHODS.has(method)) {
      kind = 'span';
      const nameArg = args?.namedChildren[1] ?? args?.namedChildren[0];
      name = nameArg?.text.replace(/^["'`]|["'`]$/g, '') ?? 'span';
    } else if (METRIC_METHODS.has(method)) {
      kind = 'metric';
      name = firstArg?.text.replace(/^["'`]|["'`]$/g, '') ?? 'metric';
    } else if (method === 'RecordError' || method === 'SetStatus') {
      kind = 'event';
      name = method;
    }

    const loc = toLocation(call, filePath);
    nodes.push({
      id: nodeId('telemetry', filePath, loc.line, `${kind}:${name}`),
      type: 'telemetry', name,
      location: loc, children: [],
      metadata: {
        kind, sdk,
        instrumentation: 'manual',
        carriesContext: kind === 'span',
        ...(kind === 'span' ? { span: { name, kind: 'internal' as const, attributes: {} } } : {}),
      },
    });
  }

  return nodes;
}

function detectSDK(objPath: string, method: string): SDK | null {
  if (TRACER_PATTERNS.some(p => p.test(objPath))) {
    if (SPAN_METHODS.has(method) || method === 'RecordError' || method === 'SetStatus') return 'otel';
  }
  if (METER_PATTERNS.some(p => p.test(objPath))) {
    if (METRIC_METHODS.has(method)) return 'custom';
  }
  return null;
}
