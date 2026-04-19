"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractLogs = extractLogs;
const ast_helpers_1 = require("../../utils/ast-helpers");
const id_1 = require("../../utils/id");
/** Mapeamento de método → nível de log */
const LOG_LEVELS = {
    trace: 'trace',
    debug: 'debug',
    verbose: 'debug',
    info: 'info',
    log: 'log',
    warn: 'warn',
    warning: 'warn',
    error: 'error',
    fatal: 'fatal',
    critical: 'fatal',
};
const LOG_PATTERNS = [
    { pattern: /\bconsole\b/, library: 'console' },
    { pattern: /\blogger\b/i, library: 'custom' },
    { pattern: /\bwins?ton\b/i, library: 'winston' },
    { pattern: /\bpino\b/i, library: 'pino' },
    { pattern: /\bbunyan\b/i, library: 'bunyan' },
    { pattern: /\blog4[jJ]s?\b/, library: 'log4js' },
    { pattern: /\bdebug\b/, library: 'debug' },
    { pattern: /\bthis\.log/, library: 'custom' },
    { pattern: /\bthis\.logger\b/, library: 'custom' },
];
/**
 * Extrai chamadas de log de um arquivo TypeScript/JavaScript.
 * Detecta: console.log/warn/error, winston, pino, bunyan, NestJS Logger
 */
function extractLogs(rootNode, filePath) {
    const logs = [];
    const calls = (0, ast_helpers_1.findAll)(rootNode, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        // Só interessa member expressions: console.log, logger.info, etc.
        if (fn.type !== 'member_expression')
            continue;
        const chain = (0, ast_helpers_1.memberChain)(fn);
        if (chain.length < 2)
            continue;
        const method = chain[chain.length - 1];
        const objPath = chain.slice(0, -1).join('.');
        const level = LOG_LEVELS[method];
        if (!level)
            continue;
        // Detecta a biblioteca
        const library = detectLibrary(objPath);
        const args = call.childForFieldName('arguments');
        const argNodes = args?.namedChildren ?? [];
        // Tenta extrair a mensagem de log (primeiro argumento string)
        const firstArg = argNodes[0];
        let message;
        if (firstArg) {
            const strVal = (0, ast_helpers_1.extractStringValue)(firstArg);
            if (strVal) {
                message = strVal.slice(0, 300);
            }
            else if (firstArg.type === 'template_string') {
                message = firstArg.text.slice(1, -1).slice(0, 300); // Remove backticks
            }
        }
        // Detecta dados estruturados (objeto como argumento)
        const hasStructuredData = argNodes.some(n => n.type === 'object' || n.type === 'identifier' && n.text !== 'null');
        // Detecta contexto (campos passados)
        const context = [];
        for (const arg of argNodes) {
            if (arg.type === 'identifier')
                context.push(arg.text);
        }
        // Verifica se inclui traceId, userId, requestId
        const allArgsText = argNodes.map(n => n.text).join(' ');
        const includesTraceId = /trace[Ii]d|traceID|trace_id|spanId/.test(allArgsText);
        const includesUserId = /user[Ii]d|userId|user_id/.test(allArgsText);
        const includesRequestId = /req[Ii]d|request[Ii]d|correlationId/.test(allArgsText);
        const category = detectLogCategory(message ?? allArgsText, level);
        const loc = (0, ast_helpers_1.toLocation)(call, filePath);
        const id = (0, id_1.nodeId)('log', filePath, loc.line, `${method}:${message?.slice(0, 20) ?? ''}`);
        logs.push({
            id,
            type: 'log',
            name: `${objPath}.${method}`,
            location: loc,
            children: [],
            metadata: {
                level,
                library,
                message,
                hasStructuredData,
                context: context.length > 0 ? context : undefined,
                includesTraceId,
                includesUserId,
                includesRequestId,
                category,
            },
        });
    }
    return logs;
}
function detectLibrary(objPath) {
    for (const { pattern, library } of LOG_PATTERNS) {
        if (pattern.test(objPath))
            return library;
    }
    return 'custom';
}
function detectLogCategory(text, level) {
    const lower = text.toLowerCase();
    if (level === 'error' || level === 'fatal') {
        if (lower.includes('auth') || lower.includes('unauthorized') || lower.includes('forbidden')) {
            return 'security';
        }
        return 'error';
    }
    if (/request|incoming|received|req/.test(lower))
        return 'request';
    if (/response|respond|reply|res/.test(lower))
        return 'response';
    if (/error|exception|fail|crash/.test(lower))
        return 'error';
    if (/performance|duration|latency|took|elapsed|ms/.test(lower))
        return 'performance';
    if (/auth|login|logout|token|jwt|session|permission|role/.test(lower))
        return 'security';
    if (/start|stop|ready|boot|shutdown|connect|disconnect/.test(lower))
        return 'lifecycle';
    if (/metric|trace|span|otel/.test(lower))
        return 'performance';
    return 'general';
}
//# sourceMappingURL=log.extractor.js.map