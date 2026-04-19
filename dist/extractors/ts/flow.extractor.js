"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFlowControl = extractFlowControl;
const ast_helpers_1 = require("../../utils/ast-helpers");
const id_1 = require("../../utils/id");
/**
 * Extrai nós de controle de fluxo de um arquivo TypeScript/JavaScript.
 * Detecta: if/else, switch, loops, try/catch, return, throw
 */
function extractFlowControl(rootNode, filePath) {
    const nodes = [];
    // If statements
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'if_statement')) {
        nodes.push(buildIfNode(node, filePath));
    }
    // Switch statements
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'switch_statement')) {
        nodes.push(buildSwitchNode(node, filePath));
    }
    // For loops
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'for_statement')) {
        nodes.push(buildLoopNode(node, filePath, 'for'));
    }
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'for_in_statement')) {
        nodes.push(buildLoopNode(node, filePath, 'for_in'));
    }
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'for_of_statement')) {
        nodes.push(buildLoopNode(node, filePath, 'for_of'));
    }
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'while_statement')) {
        nodes.push(buildLoopNode(node, filePath, 'while'));
    }
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'do_statement')) {
        nodes.push(buildLoopNode(node, filePath, 'do_while'));
    }
    // Try/catch/finally
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'try_statement')) {
        nodes.push(...buildTryCatchNodes(node, filePath));
    }
    // Return statements
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'return_statement')) {
        nodes.push(buildReturnNode(node, filePath));
    }
    // Throw statements
    for (const node of (0, ast_helpers_1.findAll)(rootNode, 'throw_statement')) {
        nodes.push(buildThrowNode(node, filePath));
    }
    return nodes;
}
function buildIfNode(node, filePath) {
    const loc = (0, ast_helpers_1.toLocation)(node, filePath);
    const condition = node.childForFieldName('condition');
    const condText = condition ? (0, ast_helpers_1.nodeText)(condition).slice(0, 200) : undefined;
    const id = (0, id_1.nodeId)('flowControl', filePath, loc.line, 'if');
    return {
        id,
        type: 'flowControl',
        name: `if (${condText ?? ''})`,
        location: loc,
        children: [],
        metadata: {
            kind: 'if',
            condition: condText,
            branches: buildIfBranches(node),
        },
    };
}
function buildIfBranches(node) {
    const branches = [];
    const consequence = node.childForFieldName('consequence');
    if (consequence) {
        branches.push({ label: 'then', children: [] });
    }
    const alternative = node.childForFieldName('alternative');
    if (alternative) {
        const label = alternative.type === 'if_statement' ? 'else_if' : 'else';
        branches.push({ label, children: [] });
    }
    return branches;
}
function buildSwitchNode(node, filePath) {
    const loc = (0, ast_helpers_1.toLocation)(node, filePath);
    const value = node.childForFieldName('value');
    const valText = value ? (0, ast_helpers_1.nodeText)(value).slice(0, 100) : undefined;
    const id = (0, id_1.nodeId)('flowControl', filePath, loc.line, 'switch');
    const body = node.childForFieldName('body');
    const cases = [];
    if (body) {
        for (const child of body.namedChildren) {
            if (child.type === 'switch_case') {
                const caseVal = child.childForFieldName('value');
                const label = caseVal ? `case ${(0, ast_helpers_1.nodeText)(caseVal).slice(0, 50)}` : 'default';
                cases.push({ label, children: [] });
            }
        }
    }
    return {
        id,
        type: 'flowControl',
        name: `switch (${valText ?? ''})`,
        location: loc,
        children: [],
        metadata: {
            kind: 'switch',
            condition: valText,
            branches: cases,
        },
    };
}
function buildLoopNode(node, filePath, kind) {
    const loc = (0, ast_helpers_1.toLocation)(node, filePath);
    const id = (0, id_1.nodeId)('flowControl', filePath, loc.line, kind);
    let condition;
    switch (kind) {
        case 'for': {
            const body = node.text.split('{')[0];
            condition = body.replace(/for\s*/, '').trim().slice(0, 100);
            break;
        }
        case 'for_of':
        case 'for_in': {
            const left = node.childForFieldName('left');
            const right = node.childForFieldName('right');
            condition = `${left?.text ?? ''} ${kind === 'for_of' ? 'of' : 'in'} ${right?.text ?? ''}`;
            break;
        }
        case 'while':
        case 'do_while': {
            const cond = node.childForFieldName('condition');
            condition = cond ? (0, ast_helpers_1.nodeText)(cond).slice(0, 100) : undefined;
            break;
        }
    }
    return {
        id,
        type: 'flowControl',
        name: kind,
        location: loc,
        children: [],
        metadata: {
            kind,
            condition,
        },
    };
}
function buildTryCatchNodes(node, filePath) {
    const nodes = [];
    const loc = (0, ast_helpers_1.toLocation)(node, filePath);
    // try block
    const tryId = (0, id_1.nodeId)('flowControl', filePath, loc.line, 'try');
    nodes.push({
        id: tryId,
        type: 'flowControl',
        name: 'try',
        location: loc,
        children: [],
        metadata: { kind: 'try' },
    });
    // catch clause
    const catchClause = node.childForFieldName('handler');
    if (catchClause) {
        const catchLoc = (0, ast_helpers_1.toLocation)(catchClause, filePath);
        const param = catchClause.childForFieldName('parameter');
        const catchId = (0, id_1.nodeId)('flowControl', filePath, catchLoc.line, 'catch');
        nodes.push({
            id: catchId,
            type: 'flowControl',
            name: `catch (${param?.text ?? 'error'})`,
            location: catchLoc,
            children: [],
            metadata: {
                kind: 'catch',
                condition: param?.text,
            },
        });
    }
    // finally clause
    const finallyClause = node.childForFieldName('finalizer');
    if (finallyClause) {
        const finallyLoc = (0, ast_helpers_1.toLocation)(finallyClause, filePath);
        const finallyId = (0, id_1.nodeId)('flowControl', filePath, finallyLoc.line, 'finally');
        nodes.push({
            id: finallyId,
            type: 'flowControl',
            name: 'finally',
            location: finallyLoc,
            children: [],
            metadata: { kind: 'finally' },
        });
    }
    return nodes;
}
function buildReturnNode(node, filePath) {
    const loc = (0, ast_helpers_1.toLocation)(node, filePath);
    const valueNode = node.namedChildren[0];
    const valueText = valueNode ? (0, ast_helpers_1.nodeText)(valueNode).slice(0, 200) : undefined;
    const id = (0, id_1.nodeId)('return', filePath, loc.line, 'return');
    // Detecta se é uma resposta HTTP
    const httpStatus = detectHttpStatus(valueNode);
    const responseType = detectResponseType(valueNode);
    return {
        id,
        type: 'return',
        name: 'return',
        location: loc,
        children: [],
        metadata: {
            kind: valueNode ? 'explicit' : 'implicit',
            value: valueText,
            httpStatus,
            responseType,
        },
    };
}
function buildThrowNode(node, filePath) {
    const loc = (0, ast_helpers_1.toLocation)(node, filePath);
    const valueNode = node.namedChildren[0];
    const id = (0, id_1.nodeId)('throw', filePath, loc.line, 'throw');
    let errorClass = 'Error';
    let message;
    let httpStatus;
    if (valueNode) {
        // new ErrorClass('message')
        if (valueNode.type === 'new_expression') {
            const constructor = valueNode.childForFieldName('constructor');
            errorClass = constructor?.text ?? 'Error';
            const args = valueNode.childForFieldName('arguments');
            if (args?.namedChildren[0]) {
                const rawMsg = args.namedChildren[0].text.replace(/^['"`]|['"`]$/g, '');
                message = rawMsg.slice(0, 200);
            }
            // Detecta HTTP status a partir do nome da classe
            httpStatus = detectHttpStatusFromErrorClass(errorClass);
        }
        else {
            errorClass = valueNode.text.split('(')[0] ?? 'Error';
        }
    }
    return {
        id,
        type: 'throw',
        name: `throw ${errorClass}`,
        location: loc,
        children: [],
        metadata: {
            kind: 'throw',
            errorClass,
            message,
            httpStatus,
            propagates: true,
        },
    };
}
function detectHttpStatus(node) {
    if (!node)
        return undefined;
    const text = node.text;
    // res.status(200).json() ou response.status(404)
    const statusMatch = text.match(/\.status\((\d{3})\)/);
    if (statusMatch)
        return parseInt(statusMatch[1], 10);
    // { statusCode: 201 }
    const statusCodeMatch = text.match(/statusCode\s*:\s*(\d{3})/);
    if (statusCodeMatch)
        return parseInt(statusCodeMatch[1], 10);
    return undefined;
}
function detectResponseType(node) {
    if (!node)
        return undefined;
    const text = node.text;
    if (text.includes('.json(') || text.includes('JSON.stringify'))
        return 'json';
    if (text.includes('.redirect('))
        return 'redirect';
    if (text.includes('.render('))
        return 'html';
    if (text.includes('.sendFile(') || text.includes('.download('))
        return 'file';
    if (text.includes('.pipe(') || text.includes('stream'))
        return 'stream';
    return undefined;
}
function detectHttpStatusFromErrorClass(className) {
    const map = {
        NotFoundException: 404,
        BadRequestException: 400,
        UnauthorizedException: 401,
        ForbiddenException: 403,
        ConflictException: 409,
        InternalServerErrorException: 500,
        UnprocessableEntityException: 422,
        NotImplementedException: 501,
        ServiceUnavailableException: 503,
        HttpException: 400,
        NotFoundError: 404,
        ValidationError: 400,
        AuthenticationError: 401,
        AuthorizationError: 403,
    };
    return map[className];
}
//# sourceMappingURL=flow.extractor.js.map