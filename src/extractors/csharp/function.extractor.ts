import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FunctionNode, ParamInfo } from '../../types/topology';

export function extractCSharpFunctions(
  rootNode: SyntaxNode,
  filePath: string,
): FunctionNode[] {
  const nodes: FunctionNode[] = [];

  for (const cls of findAll(rootNode, 'class_declaration')) {
    const className = cls.childForFieldName('name')?.text ?? 'Unknown';
    const body = cls.childForFieldName('declaration_list') ?? cls;

    for (const method of findAll(body, 'method_declaration')) {
      const fn = buildCSharpMethod(method, filePath, className, 'method');
      if (fn) nodes.push(fn);
    }

    for (const ctor of findAll(body, 'constructor_declaration')) {
      const fn = buildCSharpMethod(ctor, filePath, className, 'constructor');
      if (fn) nodes.push(fn);
    }
  }

  // Interface methods
  for (const iface of findAll(rootNode, 'interface_declaration')) {
    const ifaceName = iface.childForFieldName('name')?.text ?? 'Unknown';
    const body = iface.childForFieldName('declaration_list') ?? iface;
    for (const method of findAll(body, 'method_declaration')) {
      const fn = buildCSharpMethod(method, filePath, ifaceName, 'method');
      if (fn) nodes.push(fn);
    }
  }

  // Local functions (nested inside method bodies)
  for (const local of findAll(rootNode, 'local_function_statement')) {
    const fn = buildCSharpLocalFunction(local, filePath);
    if (fn) nodes.push(fn);
  }

  return nodes;
}

function buildCSharpMethod(
  node: SyntaxNode, filePath: string,
  className: string, kind: FunctionNode['metadata']['kind'],
): FunctionNode | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = nameNode.text;
  const fullName = `${className}.${name}`;
  const loc = toLocation(node, filePath);
  const id = nodeId('function', filePath, loc.line, fullName);

  const modifiers = node.childForFieldName('modifiers')?.text ?? '';
  const visibility: 'public' | 'private' | 'protected' =
    modifiers.includes('public') ? 'public'
    : modifiers.includes('protected') ? 'protected'
    : 'private';

  const isAsync = modifiers.includes('async');
  const returnTypeNode = node.childForFieldName('type');
  const returnType = returnTypeNode?.text;

  const annotations = findAll(node, 'attribute').map(a => a.childForFieldName('name')?.text ?? a.text.replace(/^\[|\]$/g, ''));

  return {
    id,
    type: 'function', name: fullName,
    location: loc, children: [],
    metadata: {
      kind,
      async: isAsync,
      generator: false,
      params: extractCSharpParams(node),
      returnType: returnType ?? undefined,
      visibility,
      className,
      decorators: annotations.filter(Boolean),
      errorMap: [],
    },
  };
}

function buildCSharpLocalFunction(node: SyntaxNode, filePath: string): FunctionNode | null {
  const nameNode = node.childForFieldName('name') ?? node.children.find(c => c.type === 'identifier');
  if (!nameNode) return null;

  const name = nameNode.text;
  const loc = toLocation(node, filePath);
  const modifiers = node.childForFieldName('modifiers')?.text ?? '';

  return {
    id: nodeId('function', filePath, loc.line, name),
    type: 'function', name,
    location: loc, children: [],
    metadata: {
      kind: 'declaration',
      async: modifiers.includes('async'),
      generator: false,
      params: extractCSharpParams(node),
      visibility: 'private',
      errorMap: [],
    },
  };
}

function extractCSharpParams(node: SyntaxNode): ParamInfo[] {
  const params: ParamInfo[] = [];
  const paramList = node.childForFieldName('parameter_list');
  if (!paramList) return params;

  for (const param of findAll(paramList, 'parameter')) {
    const nameNode = param.childForFieldName('name') ?? param.children.find(c => c.type === 'identifier');
    const typeNode = param.childForFieldName('type');
    if (!nameNode) continue;

    const typeName = typeNode?.text ?? 'object';
    const hasDefault = param.childForFieldName('default') !== null;
    const isNullable = typeName.endsWith('?');

    params.push({
      name: nameNode.text,
      type: typeName.replace('?', ''),
      optional: hasDefault || isNullable,
      destructured: false,
    });
  }

  return params;
}
