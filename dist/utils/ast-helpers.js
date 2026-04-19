"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findAll = findAll;
exports.findFirst = findFirst;
exports.findParent = findParent;
exports.fieldText = fieldText;
exports.nodeText = nodeText;
exports.hasDecorator = hasDecorator;
exports.getDecorators = getDecorators;
exports.decoratorName = decoratorName;
exports.decoratorFirstArg = decoratorFirstArg;
exports.getDecoratorsByName = getDecoratorsByName;
exports.extractStringValue = extractStringValue;
exports.joinHttpPaths = joinHttpPaths;
exports.isAwaited = isAwaited;
exports.calleeText = calleeText;
exports.callArguments = callArguments;
exports.extractReturnType = extractReturnType;
exports.extractParamType = extractParamType;
exports.isMemberCall = isMemberCall;
exports.memberChain = memberChain;
exports.className = className;
exports.functionName = functionName;
exports.isAsync = isAsync;
exports.isGenerator = isGenerator;
exports.toLocation = toLocation;
exports.javaVisibility = javaVisibility;
exports.isImportFrom = isImportFrom;
/**
 * Encontra todos os descendentes de um tipo específico
 */
function findAll(node, type) {
    const types = Array.isArray(type) ? type : [type];
    const results = [];
    function walk(n) {
        if (types.includes(n.type))
            results.push(n);
        for (const child of n.children)
            walk(child);
    }
    walk(node);
    return results;
}
/**
 * Encontra o primeiro descendente de um tipo específico
 */
function findFirst(node, type) {
    const types = Array.isArray(type) ? type : [type];
    function walk(n) {
        if (types.includes(n.type))
            return n;
        for (const child of n.children) {
            const found = walk(child);
            if (found)
                return found;
        }
        return null;
    }
    return walk(node);
}
/**
 * Encontra o nó pai mais próximo de um tipo específico
 */
function findParent(node, type) {
    const types = Array.isArray(type) ? type : [type];
    let current = node.parent;
    while (current) {
        if (types.includes(current.type))
            return current;
        current = current.parent;
    }
    return null;
}
/**
 * Retorna o texto de um campo filho pelo nome
 */
function fieldText(node, fieldName) {
    return node.childForFieldName(fieldName)?.text ?? null;
}
/**
 * Obtém o texto de um nó, limpando whitespace excessivo
 */
function nodeText(node) {
    return node.text.trim();
}
/**
 * Verifica se um nó tem um decorator com nome específico
 */
function hasDecorator(node, name) {
    const names = Array.isArray(name) ? name : [name];
    return getDecorators(node).some(d => names.includes(decoratorName(d)));
}
/**
 * Retorna todos os decorators de um nó (class, method, param, etc.)
 */
function getDecorators(node) {
    const decorators = [];
    // 1. Filhos diretos — cobre decorators de parâmetro (@Query, @Body, etc.)
    for (const child of node.children) {
        if (child.type === 'decorator')
            decorators.push(child);
    }
    if (decorators.length > 0)
        return decorators;
    // 2. Irmãos nomeados anteriores no pai — cobre dois casos do tree-sitter-typescript:
    //    a) @Get() aparece como irmão de method_definition dentro de class_body
    //    b) @Controller() aparece como irmão de class_declaration dentro de export_statement
    const parent = node.parent;
    if (!parent)
        return decorators;
    const namedSiblings = parent.namedChildren;
    const idx = namedSiblings.indexOf(node);
    for (let i = idx - 1; i >= 0; i--) {
        const sib = namedSiblings[i];
        if (sib.type === 'decorator') {
            decorators.unshift(sib);
        }
        else {
            break;
        }
    }
    return decorators;
}
/**
 * Extrai o nome de um decorator node
 * @Get('/path') → 'Get'
 * @Controller → 'Controller'
 */
function decoratorName(decorator) {
    // decorator → call_expression → identifier
    const call = decorator.children.find(c => c.type === 'call_expression');
    if (call) {
        const fn = call.childForFieldName('function');
        if (fn) {
            // Suporte a chained decorators: @NestFactory.create → NestFactory.create
            return fn.text;
        }
    }
    // decorator simples sem args: @Injectable
    const ident = decorator.children.find(c => c.type === 'identifier');
    return ident?.text ?? '';
}
/**
 * Extrai o primeiro argumento string de um decorator
 * @Get('/users/:id') → '/users/:id'
 */
function decoratorFirstArg(decorator) {
    const call = decorator.children.find(c => c.type === 'call_expression');
    if (!call)
        return null;
    const args = call.childForFieldName('arguments');
    if (!args)
        return null;
    const first = args.namedChildren[0];
    if (!first)
        return null;
    return extractStringValue(first);
}
/**
 * Extrai todos os decorators com nome específico de um nó
 */
function getDecoratorsByName(node, name) {
    const names = Array.isArray(name) ? name : [name];
    return getDecorators(node).filter(d => names.includes(decoratorName(d)));
}
/**
 * Extrai o valor string de um nó (string literal, template string, identifier)
 */
function extractStringValue(node) {
    if (node.type === 'string') {
        // Remove aspas
        return node.text.replace(/^['"`]|['"`]$/g, '');
    }
    if (node.type === 'template_string') {
        return node.text.replace(/^`|`$/g, '');
    }
    if (node.type === 'identifier') {
        return node.text;
    }
    return null;
}
/**
 * Junta caminhos HTTP, normalizando barras
 */
function joinHttpPaths(...parts) {
    const joined = parts
        .map(p => p.replace(/^\/+|\/+$/g, ''))
        .filter(p => p.length > 0)
        .join('/');
    return '/' + joined;
}
/**
 * Verifica se um nó está dentro de um await expression
 */
function isAwaited(node) {
    return findParent(node, 'await_expression') !== null;
}
/**
 * Extrai o texto de um call expression como string legível
 * this.userService.findAll() → 'this.userService.findAll'
 */
function calleeText(callNode) {
    const fn = callNode.childForFieldName('function');
    return fn?.text ?? callNode.text.split('(')[0];
}
/**
 * Extrai argumentos de um call_expression como array de strings
 */
function callArguments(callNode) {
    const args = callNode.childForFieldName('arguments');
    if (!args)
        return [];
    return args.namedChildren.map(n => n.text.trim());
}
/**
 * Extrai o tipo de retorno de uma function/method
 */
function extractReturnType(node) {
    // TypeScript: return_type → type_annotation → (type)
    const returnType = node.childForFieldName('return_type');
    if (returnType) {
        // Remove o ':' inicial da type_annotation
        const text = returnType.text.replace(/^:\s*/, '');
        return text || null;
    }
    return null;
}
/**
 * Extrai o tipo de um parâmetro
 */
function extractParamType(paramNode) {
    const typeAnnotation = paramNode.childForFieldName('type');
    if (typeAnnotation) {
        return typeAnnotation.text.replace(/^:\s*/, '');
    }
    return null;
}
/**
 * Verifica se um nó representa uma chamada de método de objeto específico
 * ex: this.prisma.user.findMany → object='this.prisma', property chain=['user', 'findMany']
 */
function isMemberCall(callNode, objectPattern, methodName) {
    const fn = callNode.childForFieldName('function');
    if (!fn || fn.type !== 'member_expression')
        return false;
    const methods = Array.isArray(methodName) ? methodName : [methodName];
    const prop = fn.childForFieldName('property');
    if (!prop || !methods.includes(prop.text))
        return false;
    const obj = fn.childForFieldName('object');
    return obj ? objectPattern.test(obj.text) : false;
}
/**
 * Extrai a cadeia de member expressions como array
 * this.userRepo.findOne() → ['this', 'userRepo', 'findOne']
 */
function memberChain(node) {
    const parts = [];
    function walk(n) {
        if (n.type === 'member_expression') {
            const obj = n.childForFieldName('object');
            const prop = n.childForFieldName('property');
            if (obj)
                walk(obj);
            if (prop)
                parts.push(prop.text);
        }
        else {
            parts.push(n.text);
        }
    }
    walk(node);
    return parts;
}
/**
 * Extrai o nome de uma class declaration ou expression
 */
function className(node) {
    return node.childForFieldName('name')?.text ?? null;
}
/**
 * Extrai o nome de um method/function node
 */
function functionName(node) {
    return node.childForFieldName('name')?.text ?? null;
}
/**
 * Verifica se uma função/método é async
 */
function isAsync(node) {
    return node.children.some(c => c.type === 'async');
}
/**
 * Verifica se uma função/método é generator
 */
function isGenerator(node) {
    return node.text.startsWith('function*') || node.children.some(c => c.text === '*');
}
/**
 * Converte position do tree-sitter para SourceLocation
 */
function toLocation(node, file) {
    return {
        file,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column,
    };
}
/**
 * Detecta visibility de um método Java/Kotlin/C#
 */
function javaVisibility(node) {
    const modifiers = findAll(node, 'modifiers');
    const text = modifiers.map(m => m.text).join(' ');
    if (text.includes('private'))
        return 'private';
    if (text.includes('protected'))
        return 'protected';
    return 'public';
}
/**
 * Detecta se um import é de uma biblioteca específica
 */
function isImportFrom(node, source) {
    if (node.type !== 'import_declaration')
        return false;
    const src = node.childForFieldName('source');
    if (!src)
        return false;
    const text = extractStringValue(src) ?? '';
    return typeof source === 'string' ? text === source : source.test(text);
}
//# sourceMappingURL=ast-helpers.js.map