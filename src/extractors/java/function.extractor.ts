import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, fieldText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FunctionNode, ParamInfo } from '../../types/topology';

/**
 * Extrai métodos e construtores de arquivos Java.
 * Detecta: method_declaration, constructor_declaration
 * em class_declaration e interface_declaration.
 *
 * Java não tem async/await nem generators.
 * Visibility é extraída dos access modifiers.
 */
export function extractJavaFunctions(
  rootNode: SyntaxNode,
  filePath: string,
): FunctionNode[] {
  const functions: FunctionNode[] = [];

  // Classes
  for (const classNode of findAll(rootNode, 'class_declaration')) {
    const className = fieldText(classNode, 'name') ?? 'Unknown';
    const body = classNode.childForFieldName('body') ?? classNode;

    for (const method of findAll(body, 'method_declaration')) {
      const fn = buildJavaFunction(method, filePath, className, 'method');
      if (fn) functions.push(fn);
    }
    for (const ctor of findAll(body, 'constructor_declaration')) {
      const fn = buildJavaFunction(ctor, filePath, className, 'constructor');
      if (fn) functions.push(fn);
    }
  }

  // Interfaces (default methods)
  for (const iface of findAll(rootNode, 'interface_declaration')) {
    const ifaceName = fieldText(iface, 'name') ?? 'Unknown';
    const body = iface.childForFieldName('body') ?? iface;
    for (const method of findAll(body, 'method_declaration')) {
      const fn = buildJavaFunction(method, filePath, ifaceName, 'method');
      if (fn) functions.push(fn);
    }
  }

  // Records (Java 16+)
  for (const record of findAll(rootNode, 'record_declaration')) {
    const recordName = fieldText(record, 'name') ?? 'Unknown';
    const body = record.childForFieldName('body') ?? record;
    for (const method of findAll(body, 'method_declaration')) {
      const fn = buildJavaFunction(method, filePath, recordName, 'method');
      if (fn) functions.push(fn);
    }
  }

  return functions;
}

function buildJavaFunction(
  node: SyntaxNode,
  filePath: string,
  className: string,
  kind: FunctionNode['metadata']['kind'],
): FunctionNode | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = nameNode.text;
  const fullName = `${className}.${name}`;
  const loc = toLocation(node, filePath);
  const id = nodeId('function', filePath, loc.line, fullName);

  // Extrai modifiers (public, private, protected, static, final, abstract...)
  const modifiers = findAll(node, 'modifiers');
  const modText = modifiers.map(m => m.text).join(' ');
  const visibility: 'public' | 'private' | 'protected' =
    modText.includes('private') ? 'private'
    : modText.includes('protected') ? 'protected'
    : 'public';

  // Annotations Java no método (@Override, @Transactional, etc.)
  const decorators = findAll(node, 'marker_annotation')
    .concat(findAll(node, 'annotation'))
    .map(a => {
      const aName = a.childForFieldName('name')?.text ?? '';
      return aName ? `@${aName}` : null;
    })
    .filter((d): d is string => d !== null);

  const params = extractJavaParams(node);

  // Tipo de retorno (não existe em construtores)
  const returnType = kind === 'constructor'
    ? className
    : node.childForFieldName('type')?.text;

  return {
    id,
    type: 'function',
    name: fullName,
    location: loc,
    children: [],
    metadata: {
      kind,
      async: false,
      generator: false,
      params,
      returnType,
      visibility,
      decorators: decorators.length > 0 ? decorators : undefined,
      className,
      errorMap: [],
    },
  };
}

function extractJavaParams(node: SyntaxNode): ParamInfo[] {
  const params: ParamInfo[] = [];
  const paramsNode = node.childForFieldName('parameters');
  if (!paramsNode) return params;

  for (const param of paramsNode.namedChildren) {
    if (
      param.type !== 'formal_parameter' &&
      param.type !== 'spread_parameter' // varargs: String... args
    ) continue;

    const typeNode = param.childForFieldName('type');
    const nameNode = param.childForFieldName('name');
    const name = nameNode?.text ?? 'param';
    const type = typeNode?.text ?? 'Object';
    const isVarArgs = param.type === 'spread_parameter' || param.text.includes('...');

    params.push({
      name,
      type: isVarArgs ? `${type}...` : type,
      optional: false,
      destructured: false,
    });
  }

  return params;
}
