import type { SyntaxNode } from '../../utils/ast-helpers';
import type { TelemetryNode } from '../../types/topology';
/**
 * Extrai chamadas de telemetria/observabilidade de um arquivo TypeScript.
 * Detecta:
 *   - OpenTelemetry: tracer.startSpan(), meter.createCounter(), etc.
 *   - Datadog: dd.trace.startSpan()
 *   - NewRelic: newrelic.startSegment()
 *   - Decorators: @Span(), @Trace()
 */
export declare function extractTelemetry(rootNode: SyntaxNode, filePath: string): TelemetryNode[];
//# sourceMappingURL=telemetry.extractor.d.ts.map