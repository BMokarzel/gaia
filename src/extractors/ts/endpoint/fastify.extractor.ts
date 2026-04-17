import type { SyntaxNode } from '../../../utils/ast-helpers';
import {
  findAll, toLocation, extractStringValue,
} from '../../../utils/ast-helpers';
import { nodeId } from '../../../utils/id';
import type { EndpointNode } from '../../../types/topology';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const FASTIFY_PATTERNS = [/\bfastify\b/, /\bapp\b/, /\bserver\b/, /\binstance\b/];

/**
 * Extrai endpoints Fastify de um arquivo TypeScript/JavaScript.
 * Detecta:
 *   - fastify.get('/path', handler)
 *   - fastify.route({ method: 'GET', url: '/path', handler })
 */
export function extractFastifyEndpoints(
  rootNode: SyntaxNode,
  filePath: string,
): EndpointNode[] {
  const endpoints: EndpointNode[] = [];
  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    // Padrão 1: fastify.get('/path', handler)
    if (fn.type === 'member_expression') {
      const obj = fn.childForFieldName('object');
      const prop = fn.childForFieldName('property');
      if (!obj || !prop) continue;

      const methodName = prop.text.toLowerCase();

      if (methodName === 'route') {
        // fastify.route({ method, url, handler })
        const endpoint = extractFastifyRoute(call, obj.text, filePath);
        if (endpoint) endpoints.push(endpoint);
        continue;
      }

      if (!HTTP_METHODS.has(methodName)) continue;

      const looksLikeFastify = FASTIFY_PATTERNS.some(p => p.test(obj.text));
      if (!looksLikeFastify) continue;

      const args = call.childForFieldName('arguments');
      if (!args) continue;

      const pathNode = args.namedChildren[0];
      const path = pathNode ? extractStringValue(pathNode) : null;
      if (!path) continue;

      const loc = toLocation(call, filePath);
      const id = nodeId('endpoint', filePath, loc.line, `${methodName}:${path}`);

      endpoints.push({
        id,
        type: 'endpoint',
        name: `${obj.text}.${methodName}`,
        location: loc,
        children: [],
        metadata: {
          method: methodName.toUpperCase() as EndpointNode['metadata']['method'],
          path,
          framework: 'fastify',
          request: extractFastifyPathParams(path),
          responses: [],
        },
      });
    }
  }

  return endpoints;
}

function extractFastifyRoute(
  call: SyntaxNode,
  instanceName: string,
  filePath: string,
): EndpointNode | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;

  const optionsNode = args.namedChildren[0];
  if (!optionsNode || optionsNode.type !== 'object') return null;

  let method: string | null = null;
  let url: string | null = null;

  for (const prop of optionsNode.namedChildren) {
    if (prop.type !== 'pair') continue;
    const key = prop.childForFieldName('key')?.text;
    const value = prop.childForFieldName('value');
    if (!value) continue;

    if (key === 'method') method = extractStringValue(value);
    if (key === 'url' || key === 'path') url = extractStringValue(value);
  }

  if (!method || !url) return null;

  const loc = toLocation(call, filePath);
  const id = nodeId('endpoint', filePath, loc.line, `${method}:${url}`);

  return {
    id,
    type: 'endpoint',
    name: `${instanceName}.route`,
    location: loc,
    children: [],
    metadata: {
      method: method.toUpperCase() as EndpointNode['metadata']['method'],
      path: url,
      framework: 'fastify',
      request: extractFastifyPathParams(url),
      responses: [],
    },
  };
}

function extractFastifyPathParams(path: string): EndpointNode['metadata']['request'] {
  // Fastify usa :param e também *param
  const params = [...path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => ({
    name: m[1],
    type: 'string',
    required: true,
  }));

  return { params: params.length > 0 ? params : undefined };
}
