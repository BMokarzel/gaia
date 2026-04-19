"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTelemetry = extractTelemetry;
const ast_helpers_1 = require("../../utils/ast-helpers");
const id_1 = require("../../utils/id");
/** Padrões para OpenTelemetry */
const OTEL_TRACER_PATTERNS = [/tracer/i, /opentelemetry/i, /otel/i];
const OTEL_METER_PATTERNS = [/meter/i, /metrics/i];
/** Padrões para Datadog */
const DATADOG_PATTERNS = [/dd\.trace/i, /tracer.*datadog/i, /ddtracer/i];
/** Padrões para NewRelic */
const NEWRELIC_PATTERNS = [/newrelic/i, /nr\.agent/i];
/**
 * Extrai chamadas de telemetria/observabilidade de um arquivo TypeScript.
 * Detecta:
 *   - OpenTelemetry: tracer.startSpan(), meter.createCounter(), etc.
 *   - Datadog: dd.trace.startSpan()
 *   - NewRelic: newrelic.startSegment()
 *   - Decorators: @Span(), @Trace()
 */
function extractTelemetry(rootNode, filePath) {
    const nodes = [];
    const calls = (0, ast_helpers_1.findAll)(rootNode, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        if (fn.type === 'member_expression') {
            const chain = (0, ast_helpers_1.memberChain)(fn);
            if (chain.length < 2)
                continue;
            const method = chain[chain.length - 1];
            const objPath = chain.slice(0, -1).join('.');
            const sdk = detectSDK(objPath);
            if (!sdk)
                continue;
            const loc = (0, ast_helpers_1.toLocation)(call, filePath);
            const args = call.childForFieldName('arguments');
            const firstArg = args?.namedChildren[0];
            const spanName = firstArg ? ((0, ast_helpers_1.extractStringValue)(firstArg) ?? firstArg.text.slice(0, 50)) : method;
            // Span operations
            if (method === 'startSpan' || method === 'startActiveSpan' || method === 'startSegment') {
                const id = (0, id_1.nodeId)('telemetry', filePath, loc.line, `span:${spanName}`);
                nodes.push({
                    id,
                    type: 'telemetry',
                    name: spanName,
                    location: loc,
                    children: [],
                    metadata: {
                        kind: 'span',
                        span: {
                            name: spanName,
                            kind: detectSpanKind(spanName),
                            attributes: {},
                            statusOnError: 'ERROR',
                        },
                        sdk,
                        instrumentation: 'manual',
                        carriesContext: true,
                    },
                });
                continue;
            }
            // Metric operations
            if (/createCounter|createHistogram|createGauge|createUpDownCounter/.test(method)) {
                const metricType = method.replace('create', '').toLowerCase();
                const id = (0, id_1.nodeId)('telemetry', filePath, loc.line, `metric:${spanName}`);
                nodes.push({
                    id,
                    type: 'telemetry',
                    name: spanName,
                    location: loc,
                    children: [],
                    metadata: {
                        kind: 'metric',
                        metric: {
                            name: spanName,
                            type: metricType,
                            labels: {},
                        },
                        sdk,
                        instrumentation: 'manual',
                        carriesContext: false,
                    },
                });
                continue;
            }
            // Context propagation
            if (method === 'propagate' || method === 'inject' || method === 'extract') {
                const id = (0, id_1.nodeId)('telemetry', filePath, loc.line, `context:${method}`);
                nodes.push({
                    id,
                    type: 'telemetry',
                    name: `context.${method}`,
                    location: loc,
                    children: [],
                    metadata: {
                        kind: 'context',
                        sdk,
                        instrumentation: 'manual',
                        carriesContext: true,
                    },
                });
            }
        }
    }
    // Detecta decorators de telemetria: @Span(), @Trace(), @TraceMethod()
    const classes = (0, ast_helpers_1.findAll)(rootNode, 'class_declaration');
    for (const cls of classes) {
        const methods = (0, ast_helpers_1.findAll)(cls, 'method_definition');
        for (const method of methods) {
            const decs = (0, ast_helpers_1.getDecorators)(method);
            for (const dec of decs) {
                const name = (0, ast_helpers_1.decoratorName)(dec);
                if (/span|trace|instrument/i.test(name)) {
                    const loc = (0, ast_helpers_1.toLocation)(method, filePath);
                    const id = (0, id_1.nodeId)('telemetry', filePath, loc.line, `decorator:${name}`);
                    const methodName = method.childForFieldName('name')?.text ?? '';
                    nodes.push({
                        id,
                        type: 'telemetry',
                        name: methodName,
                        location: loc,
                        children: [],
                        metadata: {
                            kind: 'span',
                            span: {
                                name: methodName,
                                kind: 'internal',
                                attributes: {},
                            },
                            sdk: 'otel',
                            instrumentation: 'decorator',
                            carriesContext: true,
                        },
                    });
                }
            }
        }
    }
    return nodes;
}
function detectSDK(objPath) {
    if (OTEL_TRACER_PATTERNS.some(p => p.test(objPath)))
        return 'otel';
    if (OTEL_METER_PATTERNS.some(p => p.test(objPath)))
        return 'otel';
    if (DATADOG_PATTERNS.some(p => p.test(objPath)))
        return 'datadog';
    if (NEWRELIC_PATTERNS.some(p => p.test(objPath)))
        return 'newrelic';
    return null;
}
function detectSpanKind(spanName) {
    const lower = spanName.toLowerCase();
    if (/http|request|endpoint|route|controller/.test(lower))
        return 'server';
    if (/client|call|fetch|axios|grpc/.test(lower))
        return 'client';
    if (/produce|publish|send|emit/.test(lower))
        return 'producer';
    if (/consume|subscribe|listen/.test(lower))
        return 'consumer';
    return 'internal';
}
//# sourceMappingURL=telemetry.extractor.js.map