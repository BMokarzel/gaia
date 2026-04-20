import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, fieldText, javaVisibility } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FunctionNode, ParamInfo } from '../../types/topology';

export function extractJavaFunctions(
  rootNode: SyntaxNode,
  filePath: string,
): FunctionNode[] {
  const functions: FunctionNode[] = [];

  for (const classNode of findAll(rootNode, 'class_declaration')) {
    const className = fieldText(classNode, 'name') ?? 'Unknown';
    const body = classNode.childForFieldName('body') ?? classNode;

    for (const method of findAll(body, 'method_declaration')) {
      const fn = buildFunctionNode(method, filePath, className, 'method');
      if (fn) functions.push(fn);
    }

    for (const ctor of findAll(body, 'constructor_declaration')) {
      const fn = buildFunctionNode(ctor, filePath, className, 'constructor');
      if (fn) functions.push(fn);
    }
  }

  // Top-level functions (rare in Java but possible in some frameworks)
  for (const method of findAll(rootNode, 'method_declaration')) {
    const parent = method.parent;
    if (!parent || parent.type !== 'class_body') {
      const fn = buildFunctionNode(method, filePath, null, 'method');
      if (fn) functions.push(fn);
    }
  }

  return functions;
}

function buildFunctionNode(
  node: SyntaxNode,
  filePath: string,
  className: string | null,
  kind: FunctionNode['metadata']['kind'],
): FunctionNode | null {
  const loc = toLocation(node, filePath);
  const name = fieldText(node, 'name') ?? (kind === 'constructor' ? className : null);
  if (!name) return null;

  const visibility = javaVisibility(node);
  const params = extractJavaParams(node);
  const returnType = node.childForFieldName('type')?.text;

  const qualifiedName = className ? `${className}.${name}` : name;
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
      returnType,
      visibility,
      className: className ?? undefined,
      errorMap: [],
    },
  };
}

function extractJavaParams(node: SyntaxNode): ParamInfo[] {
  const paramsNode = node.childForFieldName('parameters');
  if (!paramsNode) return [];

  const params: ParamInfo[] = [];

  for (const param of paramsNode.namedChildren) {
    if (param.type !== 'formal_parameter' && param.type !== 'spread_parameter') continue;

    const typeNode = param.childForFieldName('type');
    const nameNode = param.childForFieldName('name');
    const name = nameNode?.text ?? 'param';
    const type = typeNode?.text;

    params.push({ name, type, optional: false, destructured: false });
  }

  return params;
}
