import type { SyntaxNode } from '../../utils/ast-helpers';
import {
  findAll, toLocation, isAsync, isGenerator,
  extractReturnType, extractParamType, getDecorators, decoratorName,
  fieldText, className as getClassName,
} from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FunctionNode, ParamInfo } from '../../types/topology';

/** Tipos de nós que representam funções em TypeScript */
const FUNCTION_TYPES = [
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
  'generator_function_declaration',
  'generator_function',
];

/**
 * Extrai todas as funções e métodos de um arquivo TypeScript/JavaScript
 */
export function extractFunctions(
  rootNode: SyntaxNode,
  filePath: string,
): FunctionNode[] {
  const functions: FunctionNode[] = [];
  const seen = new Set<number>();

  for (const type of FUNCTION_TYPES) {
    const nodes = findAll(rootNode, type);

    for (const node of nodes) {
      if (seen.has(node.startPosition.row)) continue;
      seen.add(node.startPosition.row);

      const fn = buildFunctionNode(node, filePath);
      if (fn) functions.push(fn);
    }
  }

  return functions;
}

function buildFunctionNode(node: SyntaxNode, filePath: string): FunctionNode | null {
  const loc = toLocation(node, filePath);
  const kind = mapFunctionKind(node);

  // Descobre o nome da função
  const name = resolveFunctionName(node);
  if (!name) return null; // Ignora funções anônimas sem contexto

  // Classe pai (para métodos)
  const parentClass = findParentClass(node);

  // Decorators (apenas TypeScript)
  const decorators = getDecorators(node).map(d => decoratorName(d));

  // Visibility
  const visibility = extractVisibility(node);

  // Parâmetros
  const params = extractParams(node);

  const id = nodeId('function', filePath, loc.line, parentClass ? `${parentClass}.${name}` : name);

  return {
    id,
    type: 'function',
    name: parentClass ? `${parentClass}.${name}` : name,
    location: loc,
    children: [],
    metadata: {
      kind,
      async: isAsync(node),
      generator: isGenerator(node),
      params,
      returnType: extractReturnType(node) ?? undefined,
      visibility: visibility ?? undefined,
      decorators: decorators.length > 0 ? decorators : undefined,
      className: parentClass ?? undefined,
      errorMap: [],
    },
  };
}

function mapFunctionKind(node: SyntaxNode): FunctionNode['metadata']['kind'] {
  switch (node.type) {
    case 'function_declaration':
    case 'generator_function_declaration':
      return 'declaration';
    case 'function_expression':
    case 'generator_function':
      return 'expression';
    case 'arrow_function':
      return 'arrow';
    case 'method_definition': {
      const name = fieldText(node, 'name');
      if (name === 'constructor') return 'constructor';
      const kind = node.childForFieldName('kind');
      if (kind?.text === 'get') return 'getter';
      if (kind?.text === 'set') return 'setter';
      return 'method';
    }
    default:
      return 'declaration';
  }
}

function resolveFunctionName(node: SyntaxNode): string | null {
  // function foo() {} → name field
  const nameField = node.childForFieldName('name');
  if (nameField) return nameField.text;

  // const foo = () => {} → parent variable declarator
  const parent = node.parent;
  if (!parent) return null;

  if (parent.type === 'variable_declarator') {
    const nameNode = parent.childForFieldName('name');
    return nameNode?.text ?? null;
  }

  // const foo = function() {} → lexical_declaration → variable_declarator
  if (parent.type === 'lexical_declaration' || parent.type === 'variable_declaration') {
    const declarator = parent.namedChildren.find(c => c.type === 'variable_declarator');
    const nameNode = declarator?.childForFieldName('name');
    return nameNode?.text ?? null;
  }

  // Propriedade de objeto: { foo: () => {} }
  if (parent.type === 'pair') {
    const key = parent.childForFieldName('key');
    return key?.text ?? null;
  }

  // Propriedade de classe: class { foo = () => {} }
  if (parent.type === 'public_field_definition') {
    const prop = parent.childForFieldName('name');
    return prop?.text ?? null;
  }

  return null;
}

function findParentClass(node: SyntaxNode): string | null {
  let current = node.parent;
  while (current) {
    if (current.type === 'class_declaration' || current.type === 'class') {
      return getClassName(current);
    }
    current = current.parent;
  }
  return null;
}

function extractVisibility(node: SyntaxNode): 'public' | 'private' | 'protected' | null {
  // TypeScript accessibility modifiers
  for (const child of node.children) {
    if (child.type === 'accessibility_modifier') {
      if (child.text === 'private') return 'private';
      if (child.text === 'protected') return 'protected';
      if (child.text === 'public') return 'public';
    }
  }
  return null;
}

function extractParams(node: SyntaxNode): ParamInfo[] {
  const paramsNode = node.childForFieldName('parameters') ?? node.childForFieldName('parameter');
  if (!paramsNode) return [];

  const params: ParamInfo[] = [];

  for (const param of paramsNode.namedChildren) {
    if (
      param.type !== 'required_parameter' &&
      param.type !== 'optional_parameter' &&
      param.type !== 'rest_parameter' &&
      param.type !== 'identifier'
    ) continue;

    const decorators = getDecorators(param).map(d => decoratorName(d));
    const pattern = param.childForFieldName('pattern') ?? param.childForFieldName('name');
    const name = pattern?.text ?? param.text.replace(/[?:].*/, '').trim();
    const type = extractParamType(param);

    // Detecta valor default
    const defaultValueNode = param.childForFieldName('value');
    const defaultValue = defaultValueNode?.text;

    // Detecta destructuring
    const destructured = !!(
      pattern?.type === 'object_pattern' ||
      pattern?.type === 'array_pattern'
    );

    params.push({
      name,
      type: type ?? undefined,
      optional: param.type === 'optional_parameter' || param.text.includes('?'),
      defaultValue,
      destructured,
      decorators: decorators.length > 0 ? decorators : undefined,
    });
  }

  return params;
}
