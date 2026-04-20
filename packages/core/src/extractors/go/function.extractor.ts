import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, fieldText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FunctionNode, ParamInfo } from '../../types/topology';

export function extractGoFunctions(
  rootNode: SyntaxNode,
  filePath: string,
): FunctionNode[] {
  const functions: FunctionNode[] = [];

  // Regular functions: func name(params) returns { body }
  for (const node of findAll(rootNode, 'function_declaration')) {
    const fn = buildFunctionNode(node, filePath, null, 'declaration');
    if (fn) functions.push(fn);
  }

  // Methods: func (recv ReceiverType) name(params) returns { body }
  for (const node of findAll(rootNode, 'method_declaration')) {
    const fn = buildMethodNode(node, filePath);
    if (fn) functions.push(fn);
  }

  // Function literals: func(...) { ... }
  for (const node of findAll(rootNode, 'func_literal')) {
    const fn = buildFuncLiteralNode(node, filePath);
    if (fn) functions.push(fn);
  }

  return functions;
}

function buildFunctionNode(
  node: SyntaxNode,
  filePath: string,
  receiverType: string | null,
  kind: FunctionNode['metadata']['kind'],
): FunctionNode | null {
  const loc = toLocation(node, filePath);
  const name = fieldText(node, 'name');
  if (!name) return null;

  const params = extractGoParams(node);
  const returnType = extractGoReturnType(node);
  const qualifiedName = receiverType ? `${receiverType}.${name}` : name;

  const visibility: 'public' | 'private' = name[0] === name[0].toUpperCase() ? 'public' : 'private';

  const id = nodeId('function', filePath, loc.line, qualifiedName);

  return {
    id,
    type: 'function',
    name: qualifiedName,
    location: loc,
    children: [],
    metadata: {
      kind,
      async: false,
      generator: false,
      params,
      returnType: returnType ?? undefined,
      visibility,
      className: receiverType ?? undefined,
      errorMap: [],
    },
  };
}

function buildMethodNode(node: SyntaxNode, filePath: string): FunctionNode | null {
  const loc = toLocation(node, filePath);
  const name = fieldText(node, 'name');
  if (!name) return null;

  // receiver field: (r *ReceiverType)
  const receiver = node.childForFieldName('receiver');
  let receiverType: string | null = null;
  if (receiver) {
    // parameter_list → parameter_declaration
    const paramDecl = receiver.namedChildren[0];
    if (paramDecl) {
      const typeNode = paramDecl.childForFieldName('type');
      receiverType = typeNode?.text.replace(/^\*/, '') ?? null;
    }
  }

  const params = extractGoParams(node);
  const returnType = extractGoReturnType(node);
  const qualifiedName = receiverType ? `${receiverType}.${name}` : name;
  const visibility: 'public' | 'private' = name[0] === name[0].toUpperCase() ? 'public' : 'private';

  const id = nodeId('function', filePath, loc.line, qualifiedName);

  return {
    id,
    type: 'function',
    name: qualifiedName,
    location: loc,
    children: [],
    metadata: {
      kind: 'method',
      async: false,
      generator: false,
      params,
      returnType: returnType ?? undefined,
      visibility,
      className: receiverType ?? undefined,
      errorMap: [],
    },
  };
}

function buildFuncLiteralNode(node: SyntaxNode, filePath: string): FunctionNode | null {
  const loc = toLocation(node, filePath);

  // Try to get name from parent (e.g. variable assignment)
  let name: string | null = null;
  const parent = node.parent;
  if (parent?.type === 'short_var_declaration' || parent?.type === 'var_spec') {
    const left = parent.namedChildren[0];
    name = left?.text ?? null;
  }
  if (!name) return null;

  const params = extractGoParams(node);
  const returnType = extractGoReturnType(node);
  const id = nodeId('function', filePath, loc.line, name);

  return {
    id,
    type: 'function',
    name,
    location: loc,
    children: [],
    metadata: {
      kind: 'expression',
      async: false,
      generator: false,
      params,
      returnType: returnType ?? undefined,
      visibility: 'private',
      errorMap: [],
    },
  };
}

function extractGoParams(node: SyntaxNode): ParamInfo[] {
  const paramsNode = node.childForFieldName('parameters');
  if (!paramsNode) return [];

  const params: ParamInfo[] = [];

  for (const param of paramsNode.namedChildren) {
    if (param.type !== 'parameter_declaration' && param.type !== 'variadic_parameter_declaration') continue;

    const typeNode = param.childForFieldName('type');
    const nameNode = param.childForFieldName('name');

    // Go parameters can have multiple names: (a, b int)
    const names = nameNode ? [nameNode] : [];
    for (const n of param.namedChildren.filter(c => c.type === 'identifier')) {
      if (!names.includes(n)) names.push(n);
    }

    const type = typeNode?.text ?? '';
    const isVariadic = param.type === 'variadic_parameter_declaration';

    if (names.length === 0) {
      params.push({ name: '_', type, optional: isVariadic, destructured: false });
    } else {
      for (const n of names) {
        if (n.text === type) continue; // skip if same as type (no name case)
        params.push({ name: n.text, type, optional: isVariadic, destructured: false });
      }
    }
  }

  return params;
}

function extractGoReturnType(node: SyntaxNode): string | null {
  const result = node.childForFieldName('result');
  if (!result) return null;
  return result.text || null;
}
