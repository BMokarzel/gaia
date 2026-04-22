import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { ExternalCallNode } from '../../types/topology';
import { normalizeHttpPath } from '../ts/http-client.extractor';

/**
 * RestTemplate method → HTTP method
 * Patterns: restTemplate.getForObject(...), restTemplate.postForEntity(...)
 * restTemplate.exchange(url, HttpMethod.POST, ...)
 */
const REST_TEMPLATE_METHODS: Record<string, string> = {
  getForObject: 'GET',
  getForEntity: 'GET',
  headForHeaders: 'HEAD',
  optionsForAllow: 'OPTIONS',
  postForObject: 'POST',
  postForEntity: 'POST',
  postForLocation: 'POST',
  put: 'PUT',
  patchForObject: 'PATCH',
  delete: 'DELETE',
};

const REST_CLIENT_NAMES = new Set([
  'resttemplate', 'restclient', 'webclient', 'httpclient',
  'feign', 'retrofit', 'okhttp',
]);

/**
 * WebClient/RestClient chain methods → HTTP method
 * e.g. webClient.get(), webClient.post(), etc.
 */
const WEBCLIENT_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

export function extractJavaHttpClients(
  rootNode: SyntaxNode,
  filePath: string,
): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];
  const calls = findAll(rootNode, 'method_invocation');

  for (const call of calls) {
    const nameNode = call.childForFieldName('name');
    const objNode = call.childForFieldName('object');
    if (!nameNode || !objNode) continue;

    const methodName = nameNode.text;
    const objText = objNode.text.toLowerCase();

    // RestTemplate.exchange(url, HttpMethod.METHOD, ...)
    if (methodName === 'exchange') {
      const node = buildFromExchange(call, filePath);
      if (node) results.push(node);
      continue;
    }

    // RestTemplate shorthand methods: getForObject, postForEntity, etc.
    const httpMethod = REST_TEMPLATE_METHODS[methodName];
    if (httpMethod) {
      const isRestClient = REST_CLIENT_NAMES.has(objText) ||
        /rest|http|client|template/i.test(objText);
      if (isRestClient) {
        const node = buildFromRestTemplate(call, filePath, httpMethod);
        if (node) results.push(node);
      }
      continue;
    }

    // WebClient/RestClient fluent API: webClient.get().uri("/path")
    if (WEBCLIENT_HTTP_METHODS.has(methodName.toLowerCase())) {
      const isWebClient = /webclient|restclient|fluent/i.test(objText);
      if (isWebClient) {
        // Look for .uri() chained after this call
        const uriNode = findChainedUri(call);
        if (uriNode) {
          const urlNode = uriNode.childForFieldName('arguments')?.namedChildren[0];
          const url = urlNode ? extractJavaStringLit(urlNode) : null;
          if (url && url.startsWith('/')) {
            const node = buildNode(call, filePath, methodName.toUpperCase(), url);
            if (node) results.push(node);
          }
        }
      }
    }
  }

  return results;
}

function buildFromRestTemplate(
  call: SyntaxNode,
  filePath: string,
  method: string,
): ExternalCallNode | null {
  const args = call.childForFieldName('arguments');
  const urlNode = args?.namedChildren[0];
  if (!urlNode) return null;

  const url = extractJavaStringLit(urlNode);
  if (!url) return null;
  if (!url.startsWith('/') && !url.startsWith('http')) return null;

  const path = extractPathFromUrl(url);
  return buildNode(call, filePath, method, path);
}

function buildFromExchange(call: SyntaxNode, filePath: string): ExternalCallNode | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;

  const argNodes = args.namedChildren;
  const urlNode = argNodes[0];
  const methodArg = argNodes[1]; // HttpMethod.GET or "GET"

  if (!urlNode || !methodArg) return null;

  const url = extractJavaStringLit(urlNode);
  if (!url) return null;
  if (!url.startsWith('/') && !url.startsWith('http')) return null;

  // Extract HTTP method from HttpMethod.GET or string literal
  let method = 'GET';
  const methodText = methodArg.text.trim();
  const httpMethodMatch = methodText.match(/HttpMethod\.([A-Z]+)|"([A-Z]+)"/);
  if (httpMethodMatch) method = httpMethodMatch[1] ?? httpMethodMatch[2];

  const path = extractPathFromUrl(url);
  return buildNode(call, filePath, method, path);
}

/** Looks for .uri("...") method call chained after a WebClient method call */
function findChainedUri(call: SyntaxNode): SyntaxNode | null {
  const parent = call.parent;
  if (!parent) return null;

  // parent might be a method_invocation for the chained call
  if (parent.type === 'method_invocation') {
    const name = parent.childForFieldName('name')?.text;
    if (name === 'uri') return parent;
  }

  return null;
}

function extractJavaStringLit(node: SyntaxNode): string | null {
  if (node.type === 'string_literal') {
    // Java string: "content" — strip quotes
    const text = node.text;
    if (text.startsWith('"') && text.endsWith('"')) {
      return text.slice(1, -1);
    }
  }
  // Variable reference — try to resolve from text heuristically
  const text = node.text;
  if (text.includes('"')) {
    const match = text.match(/"([^"]+)"/);
    return match ? match[1] : null;
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
