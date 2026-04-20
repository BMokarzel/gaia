import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FunctionNode, ParamInfo } from '../../types/topology';

/**
 * Extrai funções e métodos de arquivos Go.
 * Detecta: function_declaration, method_declaration
 *
 * Em Go não existe async/await nem generators no sentido JS/TS.
 * Visibility é por convenção: maiúscula = exported (public), minúscula = unexported (private).
 */
export function extractGoFunctions(
  rootNode: SyntaxNode,
  filePath: string,
): FunctionNode[] {
  const functions: FunctionNode[] = [];

  // func name(params) result { body }
  for (const node of findAll(rootNode, 'function_declaration')) {
    const fn = buildGoFunction(node, filePath, null);
    if (fn) functions.push(fn);
  }

  // func (recv *ReceiverType) name(params) result { body }
  for (const node of findAll(rootNode, 'method_declaration')) {
    const receiverType = extractReceiverType(node);
    const fn = buildGoFunction(node, filePath, receiverType);
    if (fn) functions.push(fn);
  }

  return functions;
}

function buildGoFunction(
  node: SyntaxNode,
  filePath: string,
  receiverType: string | null,
): FunctionNode | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = nameNode.text;
  const loc = toLocation(node, filePath);
  const fullName = receiverType ? `${receiverType}.${name}` : name;
  const id = nodeId('function', filePath, loc.line, fullName);

  // Em Go: exported = começa com letra maiúscula
  const visibility: 'public' | 'private' = /^[A-Z]/.test(name) ? 'public' : 'private';

  return {
    id,
    type: 'function',
    name: fullName,
    location: loc,
    children: [],
    metadata: {
      kind: receiverType ? 'method' : 'declaration',
      async: false,
      generator: false,
      params: extractGoParams(node),
      returnType: extractGoReturnType(node) ?? undefined,
      visibility,
      className: receiverType ?? undefined,
      errorMap: [],
    },
  };
}

/**
 * Extrai o tipo do receiver de um method_declaration.
 * func (r *Router) Handle(...) → "Router"
 * func (s Service) Get(...) → "Service"
 */
function extractReceiverType(node: SyntaxNode): string | null {
  // tree-sitter-go: method_declaration → receiver (parameter_list) → parameter_declaration → type
  const receiver = node.childForFieldName('receiver');
  if (!receiver) return null;

  // Tenta via AST primeiro
  for (const param of receiver.namedChildren) {
    if (param.type === 'parameter_declaration') {
      const typeNode = param.childForFieldName('type');
      if (typeNode) {
        // pointer type: *Router → Router
        if (typeNode.type === 'pointer_type') {
          return typeNode.namedChildren[0]?.text ?? typeNode.text.replace('*', '');
        }
        return typeNode.text;
      }
    }
  }

  // Fallback: parse do texto do receiver "(r *TypeName)" ou "(r TypeName)"
  const text = receiver.text.replace(/[()]/g, '').trim();
  const match = text.match(/\*?([A-Z][a-zA-Z0-9_]*)(?:\s|$)/);
  return match ? match[1] : null;
}

/**
 * Extrai os parâmetros de uma function/method declaration em Go.
 * Suporta: a int, b string, c, d float64, e ...interface{}
 */
function extractGoParams(node: SyntaxNode): ParamInfo[] {
  const params: ParamInfo[] = [];
  const paramsNode = node.childForFieldName('parameters');
  if (!paramsNode) return params;

  for (const param of paramsNode.namedChildren) {
    if (
      param.type !== 'parameter_declaration' &&
      param.type !== 'variadic_parameter_declaration'
    ) continue;

    const isVariadic = param.type === 'variadic_parameter_declaration';
    const typeNode = param.childForFieldName('type');
    const typeName = typeNode?.text ?? 'interface{}';
    const displayType = isVariadic ? `...${typeName}` : typeName;

    // Um parameter_declaration pode ter múltiplos identificadores: a, b int
    const nameNodes = param.children.filter(c => c.type === 'identifier');

    if (nameNodes.length > 0) {
      for (const n of nameNodes) {
        params.push({
          name: n.text,
          type: displayType,
          optional: false,
          destructured: false,
        });
      }
    } else {
      // Parâmetro sem nome — comum em interfaces
      params.push({
        name: '_',
        type: displayType,
        optional: false,
        destructured: false,
      });
    }
  }

  return params;
}

/**
 * Extrai o tipo de retorno da função.
 * func () error → "error"
 * func () (string, error) → "string, error"
 */
function extractGoReturnType(node: SyntaxNode): string | null {
  const result = node.childForFieldName('result');
  if (!result) return null;
  // Remove parênteses externos se presentes
  return result.text.replace(/^\(|\)$/g, '').trim() || null;
}
