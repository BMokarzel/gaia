import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { TelemetryNode } from '../../types/topology';

type SDK = TelemetryNode['metadata']['sdk'];

const SPAN_METHODS = new Set(['StartActiveSpan', 'StartSpan', 'StartActivity', 'Start']);
const METRIC_METHODS = new Set(['CreateCounter', 'CreateHistogram', 'CreateGauge',
  'Add', 'Record', 'Observe', 'Increment']);

export function extractCSharpTelemetry(
  rootNode: SyntaxNode,
  filePath: string,
): TelemetryNode[] {
  const nodes: TelemetryNode[] = [];

  // Attribute-based: [Activity], [Trace]
  for (const method of findAll(rootNode, 'method_declaration')) {
    const attrs = findAll(method, 'attribute');
    for (const attr of attrs) {
      const attrName = attr.childForFieldName('name')?.text ?? '';
      if (!/Activity|Trace|Span|Metric/.test(attrName)) continue;
      const nameMatch = attr.text.match(/["']([^"']+)["']/);
      const name = nameMatch ? nameMatch[1] : (method.childForFieldName('name')?.text ?? 'span');
      const isMetric = /Metric/.test(attrName);
      const kind: TelemetryNode['metadata']['kind'] = isMetric ? 'metric' : 'span';
      const loc = toLocation(method, filePath);
      nodes.push({
        id: nodeId('telemetry', filePath, loc.line, `${kind}:${name}`),
        type: 'telemetry', name,
        location: loc, children: [],
        metadata: {
          kind, sdk: 'otel',
          instrumentation: 'decorator',
          carriesContext: !isMetric,
          ...(kind === 'span' ? { span: { name, kind: 'internal' as const, attributes: {} } } : {}),
        },
      });
    }
  }

  // Imperative: tracer.StartActiveSpan("name"), meter.CreateCounter("name")
  for (const call of findAll(rootNode, 'invocation_expression')) {
    const expr = call.childForFieldName('expression');
    if (!expr || expr.type !== 'member_access_expression') continue;

    const obj = expr.childForFieldName('expression')?.text ?? '';
    const method = expr.childForFieldName('name')?.text ?? '';

    const sdk = detectSDK(obj, method);
    if (!sdk) continue;

    const argList = call.childForFieldName('argument_list');
    const firstArg = argList?.namedChildren.find(a => a.type === 'argument');
    const argExpr = firstArg?.childForFieldName('expression') ?? firstArg;
    const name = argExpr?.text.replace(/^"|"$/g, '') ?? method;

    const kind: TelemetryNode['metadata']['kind'] =
      SPAN_METHODS.has(method) ? 'span'
      : METRIC_METHODS.has(method) ? 'metric'
      : 'event';

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

function detectSDK(obj: string, method: string): SDK | null {
  if (/tracer|activitySource|activity/i.test(obj) && SPAN_METHODS.has(method)) return 'otel';
  if (/meter|metrics/i.test(obj) && METRIC_METHODS.has(method)) return 'otel';
  return null;
}
