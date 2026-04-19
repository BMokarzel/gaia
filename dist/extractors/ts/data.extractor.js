"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDataNodes = extractDataNodes;
const ast_helpers_1 = require("../../utils/ast-helpers");
const id_1 = require("../../utils/id");
/**
 * Extrai nós de dados de um arquivo TypeScript/JavaScript.
 * Detecta: interfaces, types, enums, classes, imports, exports,
 *          variáveis globais/módulo, constantes
 */
function extractDataNodes(rootNode, filePath) {
    const nodes = [];
    // Interface declarations
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'interface_declaration')) {
        nodes.push(buildInterfaceNode(node, filePath));
    }
    // Type alias declarations
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'type_alias_declaration')) {
        nodes.push(buildTypeNode(node, filePath));
    }
    // Enum declarations
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'enum_declaration')) {
        nodes.push(buildEnumNode(node, filePath));
    }
    // Top-level variable declarations (const/let/var no módulo)
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'lexical_declaration')) {
        if (!isModuleLevel(node))
            continue;
        const varNodes = buildVariableNodes(node, filePath);
        nodes.push(...varNodes);
    }
    // Import declarations
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'import_declaration')) {
        const importNode = buildImportNode(node, filePath);
        if (importNode)
            nodes.push(importNode);
    }
    // Export declarations (re-exports)
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'export_statement')) {
        // Evita duplicar o que já foi capturado
        if (node.childForFieldName('declaration'))
            continue;
        const source = node.childForFieldName('source');
        if (!source)
            continue;
        const loc = (0, ast_helpers_1.toLocation)(node, filePath);
        const id = (0, id_1.nodeId)('data', filePath, loc.line, `export:${(0, ast_helpers_1.extractStringValue)(source) ?? ''}`);
        nodes.push({
            id,
            type: 'data',
            name: `export from ${(0, ast_helpers_1.extractStringValue)(source) ?? 'unknown'}`,
            location: loc,
            children: [],
            metadata: {
                kind: 'export',
                mutable: false,
                scope: 'module',
                exported: true,
            },
        });
    }
    return nodes;
}
function buildInterfaceNode(node, filePath) {
    const loc = (0, ast_helpers_1.toLocation)(node, filePath);
    const name = (0, ast_helpers_1.fieldText)(node, 'name') ?? 'unknown';
    const id = (0, id_1.nodeId)('data', filePath, loc.line, `interface:${name}`);
    const fields = extractInterfaceFields(node);
    // Detecta se está sendo exportada
    const isExported = node.parent?.type === 'export_statement' ||
        node.text.startsWith('export');
    return {
        id,
        type: 'data',
        name,
        location: loc,
        children: [],
        metadata: {
            kind: 'interface',
            mutable: false,
            scope: 'module',
            exported: isExported,
            fields,
        },
    };
}
function buildTypeNode(node, filePath) {
    const loc = (0, ast_helpers_1.toLocation)(node, filePath);
    const name = (0, ast_helpers_1.fieldText)(node, 'name') ?? 'unknown';
    const id = (0, id_1.nodeId)('data', filePath, loc.line, `type:${name}`);
    const value = node.childForFieldName('value');
    return {
        id,
        type: 'data',
        name,
        location: loc,
        children: [],
        metadata: {
            kind: 'type',
            dataType: value?.text?.slice(0, 200),
            mutable: false,
            scope: 'module',
            exported: isExported(node),
        },
    };
}
function buildEnumNode(node, filePath) {
    const loc = (0, ast_helpers_1.toLocation)(node, filePath);
    const name = (0, ast_helpers_1.fieldText)(node, 'name') ?? 'unknown';
    const id = (0, id_1.nodeId)('data', filePath, loc.line, `enum:${name}`);
    const body = node.childForFieldName('body');
    const fields = [];
    if (body) {
        for (const member of body.namedChildren) {
            if (member.type === 'enum_assignment') {
                const memberName = member.childForFieldName('name')?.text ?? '';
                const memberValue = member.childForFieldName('value');
                fields.push({
                    name: memberName,
                    type: 'enum_value',
                    required: true,
                    defaultValue: memberValue?.text,
                });
            }
            else if (member.type === 'property_identifier') {
                fields.push({ name: member.text, type: 'enum_value', required: true });
            }
        }
    }
    return {
        id,
        type: 'data',
        name,
        location: loc,
        children: [],
        metadata: {
            kind: 'enum',
            mutable: false,
            scope: 'module',
            exported: isExported(node),
            fields,
        },
    };
}
function buildVariableNodes(node, filePath) {
    const results = [];
    const isConst = node.children.some(c => c.type === 'const');
    for (const declarator of node.namedChildren) {
        if (declarator.type !== 'variable_declarator')
            continue;
        const namePart = declarator.childForFieldName('name');
        if (!namePart)
            continue;
        const name = namePart.text;
        const loc = (0, ast_helpers_1.toLocation)(declarator, filePath);
        const id = (0, id_1.nodeId)('data', filePath, loc.line, `var:${name}`);
        const valueNode = declarator.childForFieldName('value');
        const initialValue = valueNode?.text?.slice(0, 200);
        // Detecta tipo via type annotation
        const typeAnnotation = declarator.childForFieldName('type');
        const dataType = typeAnnotation?.text?.replace(/^:\s*/, '');
        const kind = isConst ? 'constant' : 'variable';
        results.push({
            id,
            type: 'data',
            name,
            location: loc,
            children: [],
            metadata: {
                kind,
                dataType,
                mutable: !isConst,
                scope: 'module',
                exported: isExported(node),
                initialValue,
            },
        });
    }
    return results;
}
function buildImportNode(node, filePath) {
    const source = node.childForFieldName('source');
    if (!source)
        return null;
    const sourceName = (0, ast_helpers_1.extractStringValue)(source) ?? '';
    const loc = (0, ast_helpers_1.toLocation)(node, filePath);
    const id = (0, id_1.nodeId)('data', filePath, loc.line, `import:${sourceName}`);
    return {
        id,
        type: 'data',
        name: `import from '${sourceName}'`,
        location: loc,
        children: [],
        metadata: {
            kind: 'import',
            mutable: false,
            scope: 'module',
            dataType: sourceName,
        },
    };
}
/** Extrai campos de uma interface TypeScript */
function extractInterfaceFields(node) {
    const fields = [];
    const body = node.childForFieldName('body');
    if (!body)
        return fields;
    for (const member of body.namedChildren) {
        if (member.type === 'property_signature') {
            const name = member.childForFieldName('name')?.text ?? '';
            const typeAnnotation = member.childForFieldName('type');
            const type = typeAnnotation?.text?.replace(/^:\s*/, '') ?? 'unknown';
            const optional = member.childForFieldName('optional') !== null ||
                member.text.includes('?');
            fields.push({ name, type, required: !optional });
        }
        if (member.type === 'method_signature') {
            const name = member.childForFieldName('name')?.text ?? '';
            const returnType = member.childForFieldName('return_type');
            const type = returnType?.text?.replace(/^:\s*/, '') ?? 'Function';
            fields.push({ name, type, required: true });
        }
    }
    return fields;
}
/** Verifica se um nó é filho de export_statement */
function isExported(node) {
    const parent = node.parent;
    if (!parent)
        return false;
    return parent.type === 'export_statement';
}
/** Verifica se uma declaração está no nível do módulo */
function isModuleLevel(node) {
    const parent = node.parent;
    if (!parent)
        return false;
    return (parent.type === 'program' ||
        parent.type === 'module' ||
        parent.type === 'export_statement');
}
//# sourceMappingURL=data.extractor.js.map