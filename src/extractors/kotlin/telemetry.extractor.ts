import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { TelemetryNode } from '../../types/topology';

type SDK = TelemetryNode['metadata']['sdk'];

const TRACER_PATTERNS = [/tracer|otel|opentelemetry/i];
const SPAN_METHODS = new Set(['startSpan', 'startActiveSpan', 'start']);
const METRIC_METHODS = new Set(['counter', 'gauge', 'histogram', 'timer',
  'increment', 'record', 'observe']);

export function extractKotlinTelemetry(
  rootNode: SyntaxNode,
  filePath: string,
): TelemetryNode[] {
  const nodes: TelemetryNode[] = [];

  // Annotation-based: @WithSpan
  for (const fn of findAll(rootNode, 'function_declaration')) {
    const annotations = findAll(fn, 'annotation');
    for (const ann of annotations) {
      if (!/WithSpan|Timed|Counted/.test(ann.text)) continue;
      const nameMatch = ann.text.match(/["']([^"']+)["']/);
      const name = nameMatch
        ? nameMatch[1]
        : fn.childForFieldName('simple_identifier')?.text ?? 'span';
      const isMetric = /Timed|Counted/.test(ann.text);
      const kind: TelemetryNode['metadata']['kind'] = isMetric ? 'metric' : 'span';
      const sdk: SDK = isMetric ? 'custom' : 'otel';
      const loc = toLocation(fn, filePath);
      nodes.push({
        id: nodeId('telemetry', filePath, loc.line, `${kind}:${name}`),
        type: 'telemetry', name,
        location: loc, children: [],
        metadata: {
          kind, sdk,
          instrumentation: 'decorator',
          carriesContext: !isMetric,
          ...(kind === 'span' ? { span: { name, kind: 'internal' as const, attributes: {} } } : {}),
        },
      });
    }
  }

  // Imperative calls
  for (const call of findAll(rootNode, 'call_expression')) {
    const nav = call.childForFieldName('navigation_expression')
      ?? call.children.find(c => c.type === 'navigation_expression');
    if (!nav) continue;

    const parts = nav.text.split('.');
    const method = parts[parts.length - 1];
    const obj = parts.slice(0, -1).join('.');

    const sdk = detectSDK(obj, method);
    if (!sdk) continue;

    const argsNode = call.childForFieldName('value_arguments');
    const firstArg = argsNode?.namedChildren[0];
    const argExpr = firstArg?.childForFieldName('expression') ?? firstArg;
    const name = argExpr?.text.replace(/^["']|["']$/g, '') ?? method;

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
  if (TRACER_PATTERNS.some(p => p.test(obj)) && SPAN_METHODS.has(method)) return 'otel';
  if (/meterRegistry|meter|micrometer/i.test(obj) && METRIC_METHODS.has(method)) return 'custom';
  return null;
}
