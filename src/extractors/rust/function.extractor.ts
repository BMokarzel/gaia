import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, fieldText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FunctionNode, ParamInfo } from '../../types/topology';

export function extractRustFunctions(
  rootNode: SyntaxNode,
  filePath: string,
): FunctionNode[] {
  const nodes: FunctionNode[] = [];

  // Top-level fn items
  for (const fn of findAll(rootNode, 'function_item')) {
    const node = buildRustFunction(fn, filePath, null);
    if (node) nodes.push(node);
  }

  // Methods inside impl blocks
  for (const impl of findAll(rootNode, 'impl_item')) {
    const selfType = impl.childForFieldName('type')?.text ?? 'Self';
    const body = impl.childForFieldName('body') ?? impl;
    for (const fn of findAll(body, 'function_item')) {
      const node = buildRustFunction(fn, filePath, selfType);
      if (node) nodes.push(node);
    }
  }

  // Trait method declarations (signatures only)
  for (const trait of findAll(rootNode, 'trait_item')) {
    const traitName = fieldText(trait, 'name') ?? 'Trait';
    const body = trait.childForFieldName('body') ?? trait;
    for (const fn of findAll(body, 'function_item')) {
      const node = buildRustFunction(fn, filePath, traitName);
      if (node) nodes.push(node);
    }
  }

  return nodes;
}

function buildRustFunction(
  node: SyntaxNode, filePath: string, implType: string | null,
): FunctionNode | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = nameNode.text;
  const loc = toLocation(node, filePath);
  const fullName = implType ? `${implType}::${name}` : name;
  const id = nodeId('function', filePath, loc.line, fullName);

  // pub fn → public; fn → private
  const visNode = node.childForFieldName('visibility_modifier');
  const visibility: 'public' | 'private' = visNode?.text === 'pub' ? 'public' : 'private';

  // async fn
  const isAsync = node.children.some(c => c.type === 'async');

  // Detect if it's a method (has self parameter)
  const params = extractRustParams(node);
  const hasSelf = params.some(p => p.name === 'self' || p.name === '&self' || p.name === '&mut self');
  const kind: FunctionNode['metadata']['kind'] =
    implType ? (name === 'new' ? 'constructor' : 'method') : 'declaration';

  return {
    id,
    type: 'function', name: fullName,
    location: loc, children: [],
    metadata: {
      kind,
      async: isAsync,
      generator: false,
      params: params.filter(p => !p.name.includes('self')),
      returnType: extractRustReturnType(node) ?? undefined,
      visibility,
      className: implType ?? undefined,
      errorMap: [],
    },
  };
}

function extractRustParams(node: SyntaxNode): ParamInfo[] {
  const params: ParamInfo[] = [];
  const paramsNode = node.childForFieldName('parameters');
  if (!paramsNode) return params;

  for (const param of paramsNode.namedChildren) {
    if (param.type === 'self_parameter' || param.text === 'self') {
      params.push({ name: 'self', type: 'Self', optional: false, destructured: false });
      continue;
    }
    if (param.type === 'parameter') {
      const pattern = param.childForFieldName('pattern');
      const type_ = param.childForFieldName('type');
      const name = pattern?.text ?? '_';
      const typeName = type_?.text ?? 'Unknown';
      params.push({ name, type: typeName, optional: false, destructured: false });
    }
  }

  return params;
}

function extractRustReturnType(node: SyntaxNode): string | null {
  const returnType = node.childForFieldName('return_type');
  return returnType?.text ?? null;
}
