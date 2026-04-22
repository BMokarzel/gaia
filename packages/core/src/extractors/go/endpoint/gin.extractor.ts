import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation, extractStringValue } from '../../../utils/ast-helpers';
import { nodeId } from '../../../utils/id';
import type { EndpointNode } from '../../../types/topology';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const ROUTER_PATTERNS = [/\br\b/, /\brouter\b/, /\bRoute\b/, /\bapp\b/, /\bserver\b/, /\bapi\b/, /\bgroup\b/];

/**
 * Scans the AST for router.Group("/prefix") assignments and returns a map
 * from variable name → path prefix.
 * Handles: api := router.Group("/orders")  and  v1 := r.Group("/v1")
 */
function buildGroupPrefixMap(rootNode: SyntaxNode): Map<string, string> {
  const prefixMap = new Map<string, string>();

  for (const decl of findAll(rootNode, 'short_var_declaration')) {
    // tree-sitter-go uses 'left' and 'right' fields on short_var_declaration
    const lhs = decl.childForFieldName('left') ??
      decl.namedChildren.find(c => c.type === 'expression_list' || c.type === 'identifier_list');
    const varName = lhs?.namedChildren[0]?.text;
    if (!varName) continue;

    const rhs = decl.childForFieldName('right') ??
      decl.namedChildren.filter(c => c.type === 'expression_list')[1];
    const call = rhs?.namedChildren.find(c => c.type === 'call_expression') ??
      (rhs?.type === 'call_expression' ? rhs : null);
    if (!call) continue;

    const fn = call.childForFieldName('function');
    if (!fn || fn.type !== 'selector_expression') continue;

    const sel = fn.childForFieldName('field');
    if (sel?.text !== 'Group') continue;

    const args = call.childForFieldName('arguments');
    const pathArg = args?.namedChildren[0];
    const prefix = pathArg ? (extractStringValue(pathArg) ?? extractGoStringLit(pathArg)) : null;
    if (prefix) prefixMap.set(varName, prefix);
  }

  return prefixMap;
}

export function extractGoEndpoints(
  rootNode: SyntaxNode,
  filePath: string,
): EndpointNode[] {
  const endpoints: EndpointNode[] = [];

  // Build map of group variable → path prefix for group routing resolution
  const groupPrefixMap = buildGroupPrefixMap(rootNode);

  // Go: call_expression → selector_expression
  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    if (fn.type !== 'selector_expression') continue;

    const obj = fn.childForFieldName('operand');
    const sel = fn.childForFieldName('field');

    if (!obj || !sel) continue;

    const methodName = sel.text;
    const objText = obj.text;

    // Go frameworks usam GET/POST/etc (maiúsculas) ou Get/Post (PascalCase)
    const httpMethod = methodName.toUpperCase();
    if (!HTTP_METHODS.has(httpMethod)) continue;

    const looksLikeRouter = ROUTER_PATTERNS.some(p => p.test(objText));
    if (!looksLikeRouter) continue;

    // Primeiro argumento é o path
    const args = call.childForFieldName('arguments');
    if (!args) continue;

    const argList = args.namedChildren;
    const pathArg = argList[0];
    const rawPath = pathArg ? (extractStringValue(pathArg) ?? extractGoStringLit(pathArg)) : null;
    if (rawPath === null) continue;

    // Resolve group prefix if the router variable is a Group() result
    const groupPrefix = groupPrefixMap.get(objText) ?? '';
    const resolvedPath = groupPrefix
      ? '/' + [groupPrefix, rawPath].map(p => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')
      : (rawPath === '' ? '/' : rawPath);
    const path = resolvedPath;

    // Handler — último argumento
    const handlerArg = argList[argList.length - 1];
    const handlerName = handlerArg?.text?.split('.').pop() ?? 'handler';

    const loc = toLocation(call, filePath);
    const id = nodeId('endpoint', filePath, loc.line, `${httpMethod}:${path}`);

    endpoints.push({
      id,
      type: 'endpoint',
      name: handlerName,
      location: loc,
      children: [],
      metadata: {
        method: httpMethod as EndpointNode['metadata']['method'],
        path,
        framework: detectGoFramework(objText, call),
        request: extractGoPathParams(path),
        responses: [],
      },
    });
  }

  // net/http: http.HandleFunc("/path", handler)
  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    const fnText = fn.text;
    if (fnText !== 'http.HandleFunc' && fnText !== 'http.Handle') continue;

    const args = call.childForFieldName('arguments');
    if (!args) continue;

    const pathArg = args.namedChildren[0];
    const path = pathArg ? (extractStringValue(pathArg) ?? extractGoStringLit(pathArg)) : null;
    if (!path) continue;

    const loc = toLocation(call, filePath);
    const id = nodeId('endpoint', filePath, loc.line, `HandleFunc:${path}`);

    endpoints.push({
      id,
      type: 'endpoint',
      name: path,
      location: loc,
      children: [],
      metadata: {
        method: 'GET', // net/http não especifica método no HandleFunc
        path,
        framework: 'unknown',
        request: extractGoPathParams(path),
        responses: [],
      },
    });
  }

  return endpoints;
}

function detectGoFramework(objText: string, call: SyntaxNode): string {
  // Heurística baseada no nome da variável e contexto
  if (/gin/i.test(objText)) return 'gin';
  if (/echo/i.test(objText)) return 'echo';
  if (/fiber/i.test(objText)) return 'fiber';
  if (/chi/i.test(objText)) return 'chi';
  return 'gin'; // default mais comum
}

function extractGoStringLit(node: SyntaxNode): string | null {
  if (node.type === 'interpreted_string_literal' || node.type === 'raw_string_literal') {
    return node.text.replace(/^["`]|["`]$/g, '');
  }
  return null;
}

function extractGoPathParams(path: string): EndpointNode['metadata']['request'] {
  // Gin/Echo: /users/:id
  // Chi: /users/{id}
  const colonParams = [...path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => ({
    name: m[1],
    type: 'string',
    required: true,
  }));
  const braceParams = [...path.matchAll(/\{([^}]+)\}/g)].map(m => ({
    name: m[1].split(':')[0],
    type: 'string',
    required: true,
  }));

  const params = [...colonParams, ...braceParams];
  return { params: params.length > 0 ? params : undefined };
}
