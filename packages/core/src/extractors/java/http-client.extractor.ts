import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { ExternalCallNode } from '../../types/topology';
import { normalizeHttpPath } from '../ts/http-client.extractor';

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

const WEBCLIENT_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

const SPRING_HTTP_ANNOTATIONS: Record<string, string> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  PatchMapping: 'PATCH',
  DeleteMapping: 'DELETE',
  RequestMapping: 'GET',
};

export function extractJavaHttpClients(
  rootNode: SyntaxNode,
  filePath: string,
): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];

  // Build a local string variable map for URL variable resolution
  const localVars = buildLocalStringMap(rootNode);

  const calls = findAll(rootNode, 'method_invocation');

  for (const call of calls) {
    const nameNode = call.childForFieldName('name');
    const objNode = call.childForFieldName('object');
    if (!nameNode || !objNode) continue;

    const methodName = nameNode.text;
    const objText = objNode.text.toLowerCase();

    // RestTemplate.exchange(url, HttpMethod.METHOD, ...)
    if (methodName === 'exchange') {
      const isRestClient = /rest|http|client|template/i.test(objText);
      if (isRestClient) {
        const node = buildFromExchange(call, filePath, localVars);
        if (node) results.push(node);
      }
      continue;
    }

    // RestTemplate shorthand: getForObject, postForEntity, etc.
    const httpMethod = REST_TEMPLATE_METHODS[methodName];
    if (httpMethod) {
      const isRestClient = /rest|http|client|template/i.test(objText);
      if (isRestClient) {
        const node = buildFromRestTemplate(call, filePath, httpMethod, localVars);
        if (node) results.push(node);
      }
      continue;
    }

    // WebClient / RestClient fluent API: webClient.get().uri("/path").retrieve()
    if (WEBCLIENT_HTTP_METHODS.has(methodName.toLowerCase())) {
      const isWebClient = /webclient|restclient|fluent/i.test(objText);
      if (isWebClient) {
        const uriNode = findChainedUriDeep(call);
        if (uriNode) {
          const urlNode = uriNode.childForFieldName('arguments')?.namedChildren[0];
          const url = urlNode ? extractJavaStringLit(urlNode, localVars) : null;
          if (url) {
            const path = extractPathFromUrl(url);
            if (path && path !== '/') {
              const node = buildNode(call, filePath, methodName.toUpperCase(), path, 'WebClient');
              if (node) results.push(node);
            }
          }
        }
      }
    }
  }

  // @FeignClient interface detection
  results.push(...extractFeignClients(rootNode, filePath));

  return results;
}

/**
 * Extracts ExternalCallNodes from @FeignClient-annotated interfaces.
 * Each method becomes an ExternalCallNode with the resolved HTTP method and path.
 */
export function extractFeignClients(
  rootNode: SyntaxNode,
  filePath: string,
): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];

  for (const ifaceNode of findAll(rootNode, 'interface_declaration')) {
    // Check for @FeignClient annotation
    const annotations = findAll(ifaceNode, 'annotation').concat(findAll(ifaceNode, 'marker_annotation'));
    const feignAnn = annotations.find(a => {
      const name = a.childForFieldName('name')?.text ?? a.namedChildren[0]?.text ?? '';
      return name === 'FeignClient';
    });
    if (!feignAnn) continue;

    // Extract base URL from annotation arguments
    let baseUrl = extractAnnotationStringAttr(feignAnn, 'url') ?? '';

    // Extract methods
    const body = ifaceNode.childForFieldName('body') ?? ifaceNode;
    for (const method of findAll(body, 'method_declaration')) {
      if (method.parent !== body) continue;

      // Look for HTTP method annotation on this method
      const methodAnns = findAll(method, 'annotation').concat(findAll(method, 'marker_annotation'));
      let httpMethod = 'GET';
      let path = '';

      for (const ann of methodAnns) {
        const annName = ann.childForFieldName('name')?.text ?? ann.namedChildren[0]?.text ?? '';
        const mapped = SPRING_HTTP_ANNOTATIONS[annName];
        if (mapped) {
          httpMethod = mapped;
          // Extract path from annotation: @GetMapping("/users/{id}") or @GetMapping(value="/users/{id}")
          path = extractAnnotationStringAttr(ann, 'value') ??
                 extractAnnotationFirstStringArg(ann) ?? '';
          break;
        }
      }

      const fullPath = baseUrl + path;
      if (!fullPath) continue;

      const normalizedPath = fullPath
        .replace(/\{[^}]+\}/g, ':param')  // {id} → :param
        .replace(/\/+$/, '')              // trailing slash
        || '/';

      const loc = toLocation(method, filePath);
      const id = nodeId('externalCall', filePath, loc.line, `${httpMethod}:${normalizedPath}`);

      results.push({
        id,
        type: 'externalCall',
        name: `${httpMethod} ${normalizedPath}`,
        location: loc,
        children: [],
        metadata: {
          method: httpMethod as ExternalCallNode['metadata']['method'],
          path: normalizedPath,
          pathNormalized: normalizeHttpPath(normalizedPath),
          baseUrl: baseUrl || undefined,
          httpClient: 'Feign',
          mergeStatus: 'provisional',
        },
      });
    }
  }

  return results;
}

/**
 * Build a map of local String variable name → string value for URL resolution.
 * Handles: String url = "http://..."; and String url = BASE + "/path";
 */
function buildLocalStringMap(rootNode: SyntaxNode): Map<string, string> {
  const map = new Map<string, string>();

  for (const decl of findAll(rootNode, 'local_variable_declaration')) {
    const typeText = decl.childForFieldName('type')?.text ?? '';
    if (typeText !== 'String') continue;

    for (const declarator of findAll(decl, 'variable_declarator')) {
      const name = declarator.childForFieldName('name')?.text;
      const value = declarator.childForFieldName('value');
      if (!name || !value) continue;

      const resolved = extractJavaStringLit(value, map);
      if (resolved) map.set(name, resolved);
    }
  }

  // Also check field_declaration for class-level String constants
  for (const decl of findAll(rootNode, 'field_declaration')) {
    const typeText = decl.childForFieldName('type')?.text ?? '';
    if (typeText !== 'String') continue;

    for (const declarator of findAll(decl, 'variable_declarator')) {
      const name = declarator.childForFieldName('name')?.text;
      const value = declarator.childForFieldName('value');
      if (!name || !value) continue;

      const resolved = extractJavaStringLit(value, map);
      if (resolved) map.set(name, resolved);
    }
  }

  return map;
}

function buildFromRestTemplate(
  call: SyntaxNode,
  filePath: string,
  method: string,
  localVars: Map<string, string>,
): ExternalCallNode | null {
  const args = call.childForFieldName('arguments');
  const urlNode = args?.namedChildren[0];
  if (!urlNode) return null;

  const url = extractJavaStringLit(urlNode, localVars);
  if (!url) return null;
  if (!url.startsWith('/') && !url.startsWith('http')) return null;

  const path = extractPathFromUrl(url);
  return buildNode(call, filePath, method, path, 'RestTemplate');
}

function buildFromExchange(
  call: SyntaxNode,
  filePath: string,
  localVars: Map<string, string>,
): ExternalCallNode | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;

  const argNodes = args.namedChildren;
  const urlNode = argNodes[0];
  const methodArg = argNodes[1];

  if (!urlNode || !methodArg) return null;

  const url = extractJavaStringLit(urlNode, localVars);
  if (!url) return null;
  if (!url.startsWith('/') && !url.startsWith('http')) return null;

  let method = 'GET';
  const methodText = methodArg.text.trim();
  const httpMethodMatch = methodText.match(/HttpMethod\.([A-Z]+)|"([A-Z]+)"/);
  if (httpMethodMatch) method = httpMethodMatch[1] ?? httpMethodMatch[2];

  const path = extractPathFromUrl(url);
  return buildNode(call, filePath, method, path, 'RestTemplate');
}

/**
 * Walks up the parent chain looking for a .uri("...") call chained after a
 * WebClient/RestClient HTTP method call. Looks up to 5 levels deep.
 */
function findChainedUriDeep(call: SyntaxNode, maxDepth = 5): SyntaxNode | null {
  let current: SyntaxNode | null = call.parent;
  let depth = 0;

  while (current && depth < maxDepth) {
    if (current.type === 'method_invocation') {
      const name = current.childForFieldName('name')?.text;
      if (name === 'uri') return current;
      // If we hit retrieve/exchange/subscribe, we've gone too far
      if (name === 'retrieve' || name === 'exchange' || name === 'subscribe' || name === 'block') break;
    }
    current = current.parent;
    depth++;
  }

  return null;
}

/**
 * Extracts a string value from a node, with optional local variable map lookup.
 * Handles:
 * - string_literal: "value"
 * - identifier: looks up in localVars map
 * - binary_expression (concatenation): "base" + "/path"
 */
function extractJavaStringLit(
  node: SyntaxNode,
  localVars?: Map<string, string>,
): string | null {
  if (node.type === 'string_literal') {
    const text = node.text;
    if (text.startsWith('"') && text.endsWith('"')) {
      return text.slice(1, -1);
    }
    // Extract any quoted segment
    const match = text.match(/"([^"]*)"/);
    return match ? match[1] : null;
  }

  if (node.type === 'identifier' && localVars) {
    return localVars.get(node.text) ?? null;
  }

  // String concatenation: "base" + "/path" or baseUrl + "/api"
  if (node.type === 'binary_expression') {
    const op = node.children.find(c => c.text === '+');
    if (!op) return null;

    const left = node.childForFieldName('left') ?? node.namedChildren[0];
    const right = node.childForFieldName('right') ?? node.namedChildren[1];

    if (!left || !right) return null;

    const leftVal = extractJavaStringLit(left, localVars) ?? '';
    const rightVal = extractJavaStringLit(right, localVars) ?? '';

    if (leftVal || rightVal) return `${leftVal}${rightVal}`;
    return null;
  }

  // Fallback: try to find a quoted string anywhere in text
  const match = node.text.match(/"([^"]+)"/);
  return match ? match[1] : null;
}

function extractPathFromUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const u = new URL(url);
      return u.pathname.replace(/\{[^}]+\}/g, ':param') || '/';
    } catch {
      const match = url.match(/https?:\/\/[^/]+(\/[^?#\s]*)?/);
      return (match?.[1] ?? '/').replace(/\{[^}]+\}/g, ':param');
    }
  }
  return (url.split('?')[0].split('#')[0] || '/').replace(/\{[^}]+\}/g, ':param');
}

function buildNode(
  call: SyntaxNode,
  filePath: string,
  method: string,
  path: string,
  httpClient: string,
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
    raw: call.text.slice(0, 300),
    metadata: {
      method: method as ExternalCallNode['metadata']['method'],
      path,
      pathNormalized: normalizeHttpPath(path),
      httpClient,
      mergeStatus: 'provisional',
    },
  };
}

/** Extracts a named attribute value from an annotation node, e.g. @FeignClient(url="...") → url value */
function extractAnnotationStringAttr(ann: SyntaxNode, attrName: string): string | null {
  const argList = ann.childForFieldName('arguments');
  if (!argList) return null;

  for (const pair of argList.namedChildren) {
    if (pair.type === 'element_value_pair') {
      const key = pair.childForFieldName('key')?.text ?? pair.namedChildren[0]?.text;
      if (key === attrName) {
        const val = pair.childForFieldName('value') ?? pair.namedChildren[1];
        return val ? extractJavaStringLit(val) : null;
      }
    }
  }
  return null;
}

/** Extracts the first string argument from an annotation, e.g. @GetMapping("/users") */
function extractAnnotationFirstStringArg(ann: SyntaxNode): string | null {
  const argList = ann.childForFieldName('arguments');
  if (!argList) return null;

  const first = argList.namedChildren[0];
  if (!first) return null;

  return extractJavaStringLit(first);
}
