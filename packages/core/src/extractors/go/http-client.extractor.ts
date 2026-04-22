import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, extractStringValue } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { ExternalCallNode } from '../../types/topology';
import { normalizeHttpPath } from '../ts/http-client.extractor';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/**
 * Maps http.Method* constants to HTTP method strings.
 */
const GO_HTTP_METHOD_CONSTANTS: Record<string, string> = {
  'http.MethodGet': 'GET',
  'http.MethodPost': 'POST',
  'http.MethodPut': 'PUT',
  'http.MethodPatch': 'PATCH',
  'http.MethodDelete': 'DELETE',
  'http.MethodHead': 'HEAD',
  'http.MethodOptions': 'OPTIONS',
};

/**
 * Builds a map from local variable name → URL template string
 * by scanning `short_var_declaration` and `assign_statement` nodes
 * for patterns like:
 *   url := fmt.Sprintf("%s/products/%s/stock", baseURL, id)
 *   url := c.baseURL + "/payments/charge"
 */
function buildUrlVarMap(rootNode: SyntaxNode): Map<string, string> {
  const urlMap = new Map<string, string>();

  const decls = [
    ...findAll(rootNode, 'short_var_declaration'),
    ...findAll(rootNode, 'assignment_statement'),
  ];

  for (const decl of decls) {
    // Get LHS variable name
    const lhs = decl.childForFieldName('left') ??
      decl.namedChildren.find(c => c.type === 'expression_list' || c.type === 'identifier_list');
    const varName = lhs?.namedChildren[0]?.text ?? lhs?.children[0]?.text;
    if (!varName || !/^(url|endpoint|uri|href|target|path|addr)$/i.test(varName)) continue;

    // Get RHS value
    const rhs = decl.childForFieldName('right') ??
      decl.namedChildren.filter(c => c.type === 'expression_list').pop();
    if (!rhs) continue;

    const rhsNode = rhs.type === 'expression_list'
      ? (rhs.namedChildren[0] ?? null)
      : rhs;
    if (!rhsNode) continue;

    const url = tryExtractUrl(rhsNode);
    if (url) urlMap.set(varName, url);
  }

  return urlMap;
}

/** Tries to extract a URL template from a RHS expression node */
function tryExtractUrl(node: SyntaxNode): string | null {
  // fmt.Sprintf("template", args...)
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function');
    if (fn?.text === 'fmt.Sprintf') {
      const args = node.childForFieldName('arguments');
      const fmtArg = args?.namedChildren[0];
      if (fmtArg?.type === 'interpreted_string_literal') {
        const fmt = fmtArg.text.slice(1, -1);
        // Replace %s/%d/%v with :param; only keep if there's a path component
        const normalized = fmt.replace(/%[sdvqf]/g, ':param');
        // If first %s is the base URL, strip it and use rest as path template
        if (normalized.startsWith(':param/')) {
          return normalized.slice(':param'.length); // → /products/:param/stock
        }
        return normalized.includes('/') ? normalized : null;
      }
    }
    return null;
  }

  // Binary expression: c.baseURL + "/payments/charge"
  if (node.type === 'binary_expression') {
    const op = node.children.find(c => c.type === '+');
    if (!op) return null;
    const right = node.childForFieldName('right') ?? node.namedChildren[1];
    if (right?.type === 'interpreted_string_literal') {
      const literal = right.text.slice(1, -1);
      if (literal.startsWith('/')) return literal;
    }
    return null;
  }

  // Direct string literal
  if (node.type === 'interpreted_string_literal') {
    return node.text.slice(1, -1);
  }

  return null;
}

/**
 * Extrai chamadas HTTP externas em Go para produzir ExternalCallNodes.
 *
 * Detecta:
 *   http.Get(url)
 *   http.Post(url, contentType, body)
 *   http.NewRequest("POST", url, body)
 *   http.NewRequestWithContext(ctx, "POST", url, body)  — also handles http.MethodGet constants
 */
export function extractGoHttpClients(
  rootNode: SyntaxNode,
  filePath: string,
): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];

  // Pre-build URL variable map for this file
  const urlVarMap = buildUrlVarMap(rootNode);

  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    const fnText = fn.text;
    const args = call.childForFieldName('arguments');
    if (!args) continue;
    const argNodes = args.namedChildren;

    // http.Get(url) → GET
    if (fnText === 'http.Get') {
      const node = buildNode(call, filePath, 'GET', argNodes[0], urlVarMap);
      if (node) results.push(node);
      continue;
    }

    // http.Post(url, contentType, body) → POST
    if (fnText === 'http.Post' || fnText === 'http.PostForm') {
      const node = buildNode(call, filePath, 'POST', argNodes[0], urlVarMap);
      if (node) results.push(node);
      continue;
    }

    // http.NewRequest(method, url, body)
    if (fnText === 'http.NewRequest') {
      const methodArg = argNodes[0];
      const urlArg = argNodes[1];
      const method = extractGoMethod(methodArg);
      if (method) {
        const node = buildNode(call, filePath, method, urlArg, urlVarMap);
        if (node) results.push(node);
      }
      continue;
    }

    // http.NewRequestWithContext(ctx, method, url, body)
    if (fnText === 'http.NewRequestWithContext') {
      const methodArg = argNodes[1];
      const urlArg = argNodes[2];
      const method = extractGoMethod(methodArg);
      if (method) {
        const node = buildNode(call, filePath, method, urlArg, urlVarMap);
        if (node) results.push(node);
      }
      continue;
    }
  }

  return results;
}

/** Extracts the HTTP method string from an argument node.
 *  Handles: string literals "GET", http.MethodGet constants. */
function extractGoMethod(node: SyntaxNode | undefined): string | null {
  if (!node) return null;

  // String literal: "GET"
  if (node.type === 'interpreted_string_literal') {
    const m = node.text.slice(1, -1).toUpperCase();
    return HTTP_METHODS.has(m) ? m : null;
  }

  // http.Method* constant
  const text = node.text;
  const method = GO_HTTP_METHOD_CONSTANTS[text];
  if (method) return method;

  return null;
}

function buildNode(
  call: SyntaxNode,
  filePath: string,
  method: string,
  urlArgNode: SyntaxNode | undefined,
  urlVarMap: Map<string, string>,
): ExternalCallNode | null {
  if (!urlArgNode) return null;

  const rawUrl = extractGoUrl(urlArgNode, urlVarMap);
  if (!rawUrl) return null;
  if (!rawUrl.startsWith('/') && !rawUrl.startsWith('http') && !rawUrl.startsWith(':param')) return null;

  const path = extractPathFromUrl(rawUrl);
  if (!path || path === '/') return null;

  let baseUrl: string | undefined;
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    try {
      const u = new URL(rawUrl);
      baseUrl = u.origin;
    } catch { /* ignore */ }
  }

  const loc = toLocation(call, filePath);
  const id = nodeId('externalCall', filePath, loc.line, `${method}:${path}`);

  return {
    id,
    type: 'externalCall',
    name: `${method} ${path}`,
    location: loc,
    children: [],
    raw: call.text,
    metadata: {
      method: method as ExternalCallNode['metadata']['method'],
      path,
      pathNormalized: normalizeHttpPath(path),
      baseUrl,
      httpClient: 'net/http',
      mergeStatus: 'provisional',
    },
  };
}

/** Extracts URL from a Go AST node, also looking up variable definitions */
function extractGoUrl(node: SyntaxNode, urlVarMap: Map<string, string>): string | null {
  // Interpreted string: "..."
  if (node.type === 'interpreted_string_literal') {
    return node.text.slice(1, -1);
  }
  // Raw string: `...`
  if (node.type === 'raw_string_literal') {
    return node.text.slice(1, -1);
  }
  // fmt.Sprintf or binary expression
  const fromExpr = tryExtractUrl(node);
  if (fromExpr) return fromExpr;

  // Variable identifier — look up in the pre-built map
  if (node.type === 'identifier') {
    const varName = node.text;
    return urlVarMap.get(varName) ?? null;
  }

  return null;
}

function extractPathFromUrl(rawUrl: string): string {
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    try {
      return new URL(rawUrl).pathname;
    } catch {
      const match = rawUrl.match(/https?:\/\/[^/]+(\/[^?#\s]*)?/);
      return match?.[1] ?? '/';
    }
  }
  // Relative path or :param template
  const pathOnly = rawUrl.split('?')[0].split('#')[0];
  return pathOnly || '/';
}
