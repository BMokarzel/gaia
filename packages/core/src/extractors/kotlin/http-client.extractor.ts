import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { ExternalCallNode } from '../../types/topology';
import { normalizeHttpPath } from '../ts/http-client.extractor';

/**
 * Extrai chamadas HTTP em Kotlin para produzir ExternalCallNodes.
 *
 * Detecta padrões Spring RestTemplate e Ktor HttpClient em Kotlin.
 * A AST Kotlin usa call_expression com navigation_expression.
 */
const REST_TEMPLATE_METHODS: Record<string, string> = {
  getForObject: 'GET',
  getForEntity: 'GET',
  postForObject: 'POST',
  postForEntity: 'POST',
  postForLocation: 'POST',
  put: 'PUT',
  patchForObject: 'PATCH',
  delete: 'DELETE',
  exchange: 'EXCHANGE', // special handling
};

export function extractKotlinHttpClients(
  rootNode: SyntaxNode,
  filePath: string,
): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];
  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    // Kotlin: call_expression { navigation_expression { expr DOT simple_identifier } value_arguments }
    const navExpr = call.namedChildren.find(c => c.type === 'navigation_expression');
    if (!navExpr) continue;

    // simple_identifier at the end of the navigation_expression is the method name
    const methodNameNode = navExpr.namedChildren[navExpr.namedChildren.length - 1];
    if (!methodNameNode || methodNameNode.type !== 'simple_identifier') continue;

    const methodName = methodNameNode.text;
    const httpMethod = REST_TEMPLATE_METHODS[methodName];
    if (!httpMethod) continue;

    // The object part is the first child of navigation_expression
    const objNode = navExpr.namedChildren[0];
    const objText = (objNode?.text ?? '').toLowerCase();

    const isRestClient = /rest|http|client|template|feign|retrofit/i.test(objText);
    if (!isRestClient) continue;

    // Extract URL from value_arguments — first string argument
    const valueArgs = call.namedChildren.find(c => c.type === 'value_arguments');
    if (!valueArgs) continue;

    const argNodes = valueArgs.namedChildren.filter(c => c.type === 'value_argument');

    if (methodName === 'exchange') {
      const node = buildFromExchange(call, filePath, argNodes);
      if (node) results.push(node);
    } else {
      const urlNode = argNodes[0];
      const url = urlNode ? extractKotlinString(urlNode) : null;
      if (url && (url.startsWith('/') || url.startsWith('http'))) {
        const path = extractPathFromUrl(url);
        const node = buildNode(call, filePath, httpMethod, path);
        if (node) results.push(node);
      }
    }
  }

  return results;
}

function buildFromExchange(
  call: SyntaxNode,
  filePath: string,
  argNodes: SyntaxNode[],
): ExternalCallNode | null {
  const urlNode = argNodes[0];
  const methodArgNode = argNodes[1];
  if (!urlNode || !methodArgNode) return null;

  const url = extractKotlinString(urlNode);
  if (!url || (!url.startsWith('/') && !url.startsWith('http'))) return null;

  // HttpMethod.GET or "GET"
  const methodText = methodArgNode.text;
  const match = methodText.match(/HttpMethod\.([A-Z]+)|"([A-Z]+)"/);
  const method = match ? (match[1] ?? match[2]) : 'GET';

  const path = extractPathFromUrl(url);
  return buildNode(call, filePath, method, path);
}

function extractKotlinString(node: SyntaxNode): string | null {
  // value_argument may wrap the actual literal
  const inner = node.type === 'value_argument'
    ? node.namedChildren[0]
    : node;

  if (!inner) return null;

  if (inner.type === 'string_literal') {
    // Kotlin string_literal: "text" — strip quotes
    const text = inner.text;
    const stripped = text.replace(/^"+|"+$/g, '').replace(/^\$\{/, '');
    return stripped || null;
  }
  if (inner.type === 'multiline_string_literal') {
    const match = inner.text.match(/"""([^"]+)"""/);
    return match ? match[1].trim() : null;
  }
  return null;
}

function extractPathFromUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      return new URL(url).pathname;
    } catch {
      const match = url.match(/https?:\/\/[^/]+(\/[^?#\s]*)?/);
      return match?.[1] ?? '/';
    }
  }
  return url.split('?')[0].split('#')[0] || '/';
}

function buildNode(
  call: SyntaxNode,
  filePath: string,
  method: string,
  path: string,
): ExternalCallNode | null {
  if (!path || path === '/') return null;

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
      httpClient: 'RestTemplate',
      mergeStatus: 'provisional',
    },
  };
}
