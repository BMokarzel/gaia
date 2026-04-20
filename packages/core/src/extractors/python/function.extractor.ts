import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, fieldText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FunctionNode, ParamInfo } from '../../types/topology';

export function extractPythonFunctions(
  rootNode: SyntaxNode,
  filePath: string,
): FunctionNode[] {
  const functions: FunctionNode[] = [];
  const seen = new Set<number>();

  for (const node of findAll(rootNode, ['function_definition', 'decorated_definition'])) {
    const fnNode = node.type === 'decorated_definition'
      ? node.namedChildren.find(c => c.type === 'function_definition')
      : node;
    if (!fnNode || seen.has(fnNode.startPosition.row)) continue;
    seen.add(fnNode.startPosition.row);

    const fn = buildFunctionNode(fnNode, filePath, node.type === 'decorated_definition' ? node : undefined);
    if (fn) functions.push(fn);
  }

  return functions;
}

function buildFunctionNode(
  node: SyntaxNode,
  filePath: string,
  decoratedNode?: SyntaxNode,
): FunctionNode | null {
  const loc = toLocation(node, filePath);
  const name = fieldText(node, 'name');
  if (!name) return null;

  const isAsync = node.children.some(c => c.type === 'async');
  const parentClass = findParentClass(node);
  const params = extractPythonParams(node);
  const returnType = extractReturnAnnotation(node);
  const decorators = extractDecorators(decoratedNode ?? node);

  const kind = name === '__init__' ? 'constructor'
    : parentClass ? 'method'
    : 'declaration';

  const qualifiedName = parentClass ? `${parentClass}.${name}` : name;
  const id = nodeId('function', filePath, loc.line, qualifiedName);

  return {
    id,
    type: 'function',
    name: qualifiedName,
    location: loc,
    children: [],
    metadata: {
      kind,
      async: isAsync,
      generator: node.children.some(c => c.text === 'yield'),
      params,
      returnType: returnType ?? undefined,
      visibility: name.startsWith('__') && name !== '__init__' ? 'private'
        : name.startsWith('_') ? 'protected' : 'public',
      className: parentClass ?? undefined,
      decorators: decorators.length > 0 ? decorators : undefined,
      errorMap: [],
    },
  };
}

function findParentClass(node: SyntaxNode): string | null {
  let current = node.parent;
  while (current) {
    if (current.type === 'class_definition') {
      return current.childForFieldName('name')?.text ?? null;
    }
    current = current.parent;
  }
  return null;
}

function extractPythonParams(node: SyntaxNode): ParamInfo[] {
  const paramsNode = node.childForFieldName('parameters');
  if (!paramsNode) return [];

  const params: ParamInfo[] = [];

  for (const param of paramsNode.namedChildren) {
    if (param.type === 'self' || param.type === 'cls') continue;

    let name = '';
    let type: string | undefined;
    let optional = false;
    let defaultValue: string | undefined;

    if (param.type === 'identifier') {
      name = param.text;
    } else if (param.type === 'typed_parameter') {
      name = param.namedChildren[0]?.text ?? '';
      const typeNode = param.childForFieldName('type');
      type = typeNode?.text;
    } else if (param.type === 'default_parameter') {
      name = param.childForFieldName('name')?.text ?? '';
      defaultValue = param.childForFieldName('value')?.text;
      optional = true;
    } else if (param.type === 'typed_default_parameter') {
      name = param.childForFieldName('name')?.text ?? '';
      type = param.childForFieldName('type')?.text;
      defaultValue = param.childForFieldName('value')?.text;
      optional = true;
    } else if (param.type === 'list_splat_pattern' || param.type === 'dictionary_splat_pattern') {
      name = param.text;
      optional = true;
    } else {
      name = param.text.replace(/[=:].*/, '').trim();
    }

    if (!name) continue;
    params.push({ name, type, optional, defaultValue, destructured: false });
  }

  return params;
}

function extractReturnAnnotation(node: SyntaxNode): string | null {
  const returnType = node.childForFieldName('return_type');
  if (returnType) return returnType.text.replace(/^->\s*/, '').trim();
  return null;
}

function extractDecorators(node: SyntaxNode): string[] {
  const decorators: string[] = [];
  for (const child of node.children) {
    if (child.type === 'decorator') {
      decorators.push(child.text.replace(/^@/, ''));
    }
  }
  return decorators;
}
