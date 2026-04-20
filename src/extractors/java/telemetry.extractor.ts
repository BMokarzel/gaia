import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { TelemetryNode } from '../../types/topology';

type SDK = TelemetryNode['metadata']['sdk'];

const TRACER_PATTERNS = [/tracer|otel|opentelemetry/i];
const SPAN_METHODS = new Set(['startSpan', 'startActiveSpan', 'start', 'startWithRemoteParent']);
const METRIC_METHODS = new Set(['counter', 'gauge', 'histogram', 'timer',
  'incrementCounter', 'recordGauge', 'recordTimer']);

export function extractJavaTelemetry(
  rootNode: SyntaxNode,
  filePath: string,
): TelemetryNode[] {
  const nodes: TelemetryNode[] = [];

  // Annotation-based: @WithSpan, @Timed, @Counted
  for (const method of findAll(rootNode, 'method_declaration')) {
    const annotations = findAll(method, 'marker_annotation').concat(findAll(method, 'annotation'));
    for (const ann of annotations) {
      const annName = ann.childForFieldName('name')?.text ?? '';
      if (annName === 'WithSpan' || annName === 'Span') {
        const spanName = extractAnnotationStringValue(ann) ?? method.childForFieldName('name')?.text ?? 'span';
        const loc = toLocation(method, filePath);
        nodes.push({
          id: nodeId('telemetry', filePath, loc.line, `span:${spanName}`),
          type: 'telemetry', name: spanName,
          location: loc, children: [],
          metadata: {
            kind: 'span', sdk: 'otel',
            instrumentation: 'decorator',
            carriesContext: true,
            span: { name: spanName, kind: 'internal', attributes: {} },
          },
        });
      }
      if (annName === 'Timed') {
        const name = extractAnnotationStringValue(ann) ?? 'timer';
        const loc = toLocation(method, filePath);
        nodes.push({
          id: nodeId('telemetry', filePath, loc.line, `metric:${name}`),
          type: 'telemetry', name,
          location: loc, children: [],
          metadata: { kind: 'metric', sdk: 'custom', instrumentation: 'decorator', carriesContext: false },
        });
      }
    }
  }

  // Imperative: tracer.startSpan("name"), meter.counter("name")
  for (const call of findAll(rootNode, 'method_invocation')) {
    const obj = call.childForFieldName('object')?.text ?? '';
    const method = call.childForFieldName('name')?.text ?? '';
    const args = call.childForFieldName('arguments');

    const sdk = detectSDK(obj, method);
    if (!sdk) continue;

    const firstArg = args?.namedChildren[0];
    const name = firstArg?.text.replace(/^["']|["']$/g, '') ?? method;

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

function extractAnnotationStringValue(ann: SyntaxNode): string | null {
  const args = ann.childForFieldName('arguments');
  if (!args) return null;
  const match = args.text.match(/["']([^"']+)["']/);
  return match ? match[1] : null;
}
