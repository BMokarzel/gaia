"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractKotlinSpringEndpoints = extractKotlinSpringEndpoints;
const ast_helpers_1 = require("../../../utils/ast-helpers");
const id_1 = require("../../../utils/id");
const SPRING_ANNOTATIONS = {
    GetMapping: 'GET',
    PostMapping: 'POST',
    PutMapping: 'PUT',
    PatchMapping: 'PATCH',
    DeleteMapping: 'DELETE',
    RequestMapping: 'GET',
};
/**
 * Extrai endpoints Spring Boot de arquivos Kotlin.
 * O AST do Kotlin é similar ao Java mas com algumas diferenças de sintaxe.
 */
function extractKotlinSpringEndpoints(rootNode, filePath) {
    const endpoints = [];
    const functions = [];
    const classes = (0, ast_helpers_1.findAll)(rootNode, 'class_declaration');
    for (const classNode of classes) {
        const modifiers = (0, ast_helpers_1.findAll)(classNode, 'annotation');
        const isController = modifiers.some(a => {
            const name = a.childForFieldName('userType')?.text
                ?? a.childForFieldName('name')?.text ?? '';
            return name === 'RestController' || name === 'Controller';
        });
        if (!isController)
            continue;
        const className = classNode.childForFieldName('name')?.text
            ?? classNode.childForFieldName('simpleIdentifier')?.text ?? 'Controller';
        const classAnnotations = modifiers;
        const requestMappingAnn = classAnnotations.find(a => {
            const name = a.childForFieldName('userType')?.text ?? '';
            return name === 'RequestMapping';
        });
        const basePath = requestMappingAnn
            ? extractKotlinAnnotationValue(requestMappingAnn)
            : '';
        // Kotlin: fun declarations dentro da classe
        const funDeclarations = (0, ast_helpers_1.findAll)(classNode, 'function_declaration');
        for (const fun of funDeclarations) {
            const funAnnotations = (0, ast_helpers_1.findAll)(fun, 'annotation');
            const httpAnnotation = funAnnotations.find(a => {
                const name = a.childForFieldName('userType')?.text ?? '';
                return name in SPRING_ANNOTATIONS;
            });
            if (!httpAnnotation)
                continue;
            const annotationName = httpAnnotation.childForFieldName('userType')?.text ?? '';
            const httpMethod = SPRING_ANNOTATIONS[annotationName] ?? 'GET';
            const methodPath = extractKotlinAnnotationValue(httpAnnotation) ?? '';
            const fullPath = joinPaths(basePath ?? '', methodPath);
            const methodName = fun.childForFieldName('simpleIdentifier')?.text ?? 'unknown';
            const loc = (0, ast_helpers_1.toLocation)(fun, filePath);
            const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `${className}.${methodName}`);
            endpoints.push({
                id,
                type: 'endpoint',
                name: `${className}.${methodName}`,
                location: loc,
                children: [],
                metadata: {
                    method: httpMethod,
                    path: fullPath,
                    framework: 'spring',
                    controller: className,
                    request: {},
                    responses: [],
                },
            });
            functions.push({
                id: (0, id_1.nodeId)('function', filePath, loc.line, `${className}.${methodName}`),
                type: 'function',
                name: `${className}.${methodName}`,
                location: loc,
                children: [],
                metadata: {
                    kind: 'method',
                    async: fun.text.includes('suspend'),
                    generator: false,
                    params: [],
                    returnType: fun.childForFieldName('type')?.text,
                    visibility: 'public',
                    className,
                    errorMap: [],
                },
            });
        }
    }
    return { endpoints, functions };
}
function extractKotlinAnnotationValue(annotation) {
    const valueArgs = annotation.childForFieldName('valueArguments');
    if (!valueArgs)
        return null;
    const text = valueArgs.text;
    const match = text.match(/["']([^"']+)["']/);
    return match ? match[1] : null;
}
function joinPaths(base, path) {
    const clean = [base, path]
        .map(p => p.replace(/^\/+|\/+$/g, ''))
        .filter(Boolean)
        .join('/');
    return '/' + clean;
}
//# sourceMappingURL=spring.extractor.js.map