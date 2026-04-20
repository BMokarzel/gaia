import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { TelemetryNode } from '../../types/topology';

type SDK = TelemetryNode['metadata']['sdk'];

const TRACER_PATTERNS = [/tracer|otel|opentelemetry/i];
const SPAN_METHODS = new Set(['start_as_current_span', 'start_span', 'use_span']);
const METRIC_METHODS = new Set(['counter', 'gauge', 'histogram', 'up_down_counter',
  'create_counter', 'create_histogram', 'inc', 'observe', 'set']);

export function extractPythonTelemetry(
  rootNode: SyntaxNode,
  filePath: string,
): TelemetryNode[] {
  const nodes: TelemetryNode[] = [];

  // Decorator-based: @tracer.start_as_current_span("name")
  for (const funcDef of findAll(rootNode, 'function_definition')) {
    const parent = funcDef.parent;
    if (!parent || parent.type !== 'decorated_definition') continue;

    for (const dec of parent.children.filter(c => c.type === 'decorator')) {
      const text = dec.text;
      if (!TRACER_PATTERNS.some(p => p.test(text))) continue;

      const spanMatch = text.match(/start_as_current_span\s*\(\s*["']([^"']+)["']/);
      if (spanMatch) {
        const loc = toLocation(funcDef, filePath);
        nodes.push({
          id: nodeId('telemetry', filePath, loc.line, `span:${spanMatch[1]}`),
          type: 'telemetry', name: spanMatch[1],
          location: loc, children: [],
          metadata: {
            kind: 'span', sdk: 'otel',
            instrumentation: 'decorator',
            carriesContext: true,
            span: { name: spanMatch[1], kind: 'internal', attributes: {} },
          },
        });
      }
    }
  }

  // Imperative: tracer.start_span("name"), meter.create_counter("name")
  for (const call of findAll(rootNode, 'call')) {
    const fn = call.childForFieldName('function');
    if (!fn || fn.type !== 'attribute') continue;

    const obj = fn.childForFieldName('object')?.text ?? '';
    const method = fn.childForFieldName('attribute')?.text ?? '';

    const sdk = detectSDK(obj, method);
    if (!sdk) continue;

    const args = call.childForFieldName('arguments');
    const firstArg = args?.namedChildren[0];
    const name = firstArg?.text.replace(/^["'f]|["']$/g, '') ?? method;

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
  if (/meter|metrics|prometheus/i.test(obj) && METRIC_METHODS.has(method)) return 'custom';
  return null;
}
