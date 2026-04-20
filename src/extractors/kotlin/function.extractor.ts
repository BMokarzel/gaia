import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, fieldText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FunctionNode, ParamInfo } from '../../types/topology';

/**
 * Extracts functions and methods from Kotlin files.
 * Handles fun declarations, suspend fun, extension functions.
 */
export function extractKotlinFunctions(
  rootNode: SyntaxNode,
  filePath: string,
): FunctionNode[] {
  const functions: FunctionNode[] = [];

  for (const node of findAll(rootNode, 'function_declaration')) {
    const fn = buildKotlinFunction(node, filePath, null);
    if (fn) functions.push(fn);
  }

  // Methods inside class bodies
  for (const classNode of findAll(rootNode, 'class_declaration')) {
    const className = fieldText(classNode, 'name') ?? classNode.childForFieldName('type_identifier')?.text ?? 'Unknown';
    const body = classNode.childForFieldName('class_body') ?? classNode;
    for (const method of findAll(body, 'function_declaration')) {
      const fn = buildKotlinFunction(method, filePath, className);
      if (fn) functions.push(fn);
    }
  }

  return functions;
}

function buildKotlinFunction(
  node: SyntaxNode,
  filePath: string,
  className: string | null,
): FunctionNode | null {
  const nameNode = node.childForFieldName('simple_identifier')
    ?? node.childForFieldName('name')
    ?? node.children.find(c => c.type === 'simple_identifier');
  if (!nameNode) return null;

  const name = nameNode.text;
  const loc = toLocation(node, filePath);
  const fullName = className ? `${className}.${name}` : name;
  const id = nodeId('function', filePath, loc.line, fullName);

  const modifiers = node.childForFieldName('modifiers')?.text ?? node.children.find(c => c.type === 'modifiers')?.text ?? '';
  const isSuspend = modifiers.includes('suspend');
  const visibility: 'public' | 'private' | 'protected' | 'internal' =
    modifiers.includes('private') ? 'private'
    : modifiers.includes('protected') ? 'protected'
    : modifiers.includes('internal') ? 'internal' as any
    : 'public';

  const annotations = findAll(node, 'annotation').map(a => a.text.replace(/^@/, '').split('(')[0]);

  return {
    id,
    type: 'function',
    name: fullName,
    location: loc,
    children: [],
    metadata: {
      kind: className ? 'method' : 'declaration',
      async: isSuspend,
      generator: false,
      params: extractKotlinParams(node),
      returnType: extractKotlinReturnType(node) ?? undefined,
      visibility: visibility as any,
      className: className ?? undefined,
      decorators: annotations.length > 0 ? annotations : undefined,
      errorMap: [],
    },
  };
}

function extractKotlinParams(node: SyntaxNode): ParamInfo[] {
  const params: ParamInfo[] = [];
  const paramsNode = node.childForFieldName('function_value_parameters')
    ?? node.childForFieldName('parameters');
  if (!paramsNode) return params;

  for (const param of findAll(paramsNode, 'function_value_parameter')) {
    const decl = param.childForFieldName('parameter') ?? param;
    const nameNode = decl.childForFieldName('simple_identifier') ?? decl.childForFieldName('name');
    const typeNode = decl.childForFieldName('type');
    if (!nameNode) continue;

    const typeName = typeNode?.text ?? 'Any';
    const optional = typeName.endsWith('?') || param.childForFieldName('default_value') !== null;

    params.push({
      name: nameNode.text,
      type: typeName.replace(/\?$/, ''),
      optional,
      destructured: false,
    });
  }

  return params;
}

function extractKotlinReturnType(node: SyntaxNode): string | null {
  // fun name(): ReturnType — colon followed by type
  const returnType = node.childForFieldName('type')
    ?? node.children.find(c => c.previousSibling?.text === ':' && c.type !== 'function_value_parameters');
  return returnType?.text ?? null;
}
