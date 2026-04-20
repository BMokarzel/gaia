import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FunctionNode, ParamInfo } from '../../types/topology';

/**
 * Extrai funções e métodos de arquivos Python.
 * Detecta: function_definition (incluindo async def, métodos de classe).
 *
 * Convenções Python de visibilidade:
 *   __name → private
 *   _name  → protected (por convenção)
 *   name   → public
 */
export function extractPythonFunctions(
  rootNode: SyntaxNode,
  filePath: string,
): FunctionNode[] {
  const functions: FunctionNode[] = [];

  for (const node of findAll(rootNode, 'function_definition')) {
    const fn = buildPythonFunction(node, filePath);
    if (fn) functions.push(fn);
  }

  return functions;
}

function buildPythonFunction(node: SyntaxNode, filePath: string): FunctionNode | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = nameNode.text;
  const loc = toLocation(node, filePath);

  // Detecta se é método de classe
  const parentClass = findParentClassName(node);
  const fullName = parentClass ? `${parentClass}.${name}` : name;
  const id = nodeId('function', filePath, loc.line, fullName);

  // async def → async: true
  const isAsync = node.children.some(c => c.type === 'async');

  // generator: contém yield (heurística baseada no texto)
  // tree-sitter não marca isso no nó — detectamos pelo conteúdo do body
  const bodyNode = node.childForFieldName('body');
  const isGenerator = !!bodyNode && findAll(bodyNode, 'yield').length > 0;

  const visibility: 'public' | 'private' | 'protected' =
    name.startsWith('__') ? 'private'
    : name.startsWith('_') ? 'protected'
    : 'public';

  // Decorators do nó pai (decorated_definition)
  const decorators = collectDecorators(node);

  const kind: FunctionNode['metadata']['kind'] =
    parentClass
      ? name === '__init__' ? 'constructor' : 'method'
      : 'declaration';

  return {
    id,
    type: 'function',
    name: fullName,
    location: loc,
    children: [],
    metadata: {
      kind,
      async: isAsync,
      generator: isGenerator,
      params: extractPythonParams(node),
      returnType: extractPythonReturnType(node) ?? undefined,
      visibility,
      decorators: decorators.length > 0 ? decorators : undefined,
      className: parentClass ?? undefined,
      errorMap: [],
    },
  };
}

/**
 * Sobe na árvore AST para encontrar o nome da classe pai.
 * Ignora funções aninhadas.
 */
function findParentClassName(node: SyntaxNode): string | null {
  let current = node.parent;
  while (current) {
    if (current.type === 'class_definition') {
      return current.childForFieldName('name')?.text ?? null;
    }
    // Se encontrou outra função antes da classe, não é método
    if (current.type === 'function_definition') return null;
    current = current.parent;
  }
  return null;
}

/**
 * Coleta decorators de um nó function_definition.
 * Em Python, os decorators ficam no nó pai decorated_definition.
 */
function collectDecorators(node: SyntaxNode): string[] {
  const parent = node.parent;
  if (!parent || parent.type !== 'decorated_definition') return [];

  return parent.children
    .filter(c => c.type === 'decorator')
    .map(d => {
      // @decorator ou @module.decorator ou @decorator(args)
      const text = d.text.replace(/^@/, '').trim();
      // Remove argumentos: @app.route('/') → 'app.route'
      return text.split('(')[0].trim();
    });
}

function extractPythonParams(node: SyntaxNode): ParamInfo[] {
  const params: ParamInfo[] = [];
  const paramsNode = node.childForFieldName('parameters');
  if (!paramsNode) return params;

  for (const param of paramsNode.namedChildren) {
    switch (param.type) {
      case 'identifier': {
        const name = param.text;
        if (name === 'self' || name === 'cls') continue;
        params.push({ name, optional: false, destructured: false });
        break;
      }
      case 'typed_parameter': {
        // param: Type
        const names = param.children.filter(c => c.type === 'identifier');
        const name = names[0]?.text ?? 'param';
        if (name === 'self' || name === 'cls') continue;
        const typeNode = param.childForFieldName('type');
        params.push({ name, type: typeNode?.text, optional: false, destructured: false });
        break;
      }
      case 'default_parameter': {
        // param = default
        const name = param.childForFieldName('name')?.text ?? param.children[0]?.text ?? 'param';
        if (name === 'self' || name === 'cls') continue;
        const defaultVal = param.childForFieldName('value')?.text;
        params.push({ name, optional: true, defaultValue: defaultVal, destructured: false });
        break;
      }
      case 'typed_default_parameter': {
        // param: Type = default
        const name = param.childForFieldName('name')?.text ?? 'param';
        if (name === 'self' || name === 'cls') continue;
        const typeNode = param.childForFieldName('type');
        const defaultVal = param.childForFieldName('value')?.text;
        params.push({ name, type: typeNode?.text, optional: true, defaultValue: defaultVal, destructured: false });
        break;
      }
      case 'list_splat_pattern':
      case 'dictionary_splat_pattern': {
        // *args ou **kwargs
        const name = param.text;
        params.push({ name, optional: true, destructured: false });
        break;
      }
    }
  }

  return params;
}

/**
 * Extrai o tipo de retorno anotado.
 * def f() -> int: → "int"
 * def f() -> Optional[str]: → "Optional[str]"
 */
function extractPythonReturnType(node: SyntaxNode): string | null {
  const returnType = node.childForFieldName('return_type');
  if (!returnType) return null;
  // tree-sitter-python: return_type inclui o "->"
  return returnType.text.replace(/^->\s*/, '').trim() || null;
}
