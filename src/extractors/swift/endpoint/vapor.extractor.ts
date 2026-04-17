import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation, memberChain, extractStringValue } from '../../../utils/ast-helpers';
import { nodeId } from '../../../utils/id';
import type { EndpointNode } from '../../../types/topology';

const VAPOR_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'on']);
const VAPOR_PATTERNS = [/\bapp\b/, /\brouter\b/, /\broutes\b/, /\bRoute\b/];

/**
 * Extrai endpoints Vapor (Swift) de arquivos Swift.
 * Detecta: app.get("path") { req in ... }
 */
export function extractVaporEndpoints(
  rootNode: SyntaxNode,
  filePath: string,
): EndpointNode[] {
  const endpoints: EndpointNode[] = [];

  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    const fn = call.children[0];
    if (!fn) continue;

    // Swift: navigation_expression → a.b.c
    if (fn.type !== 'navigation_expression') continue;

    const chain = memberChain(fn);
    if (chain.length < 2) continue;

    const method = chain[chain.length - 1].toLowerCase();
    const obj = chain.slice(0, -1).join('.');

    if (!VAPOR_METHODS.has(method)) continue;
    if (!VAPOR_PATTERNS.some(p => p.test(obj))) continue;

    // Extrai argumentos — primeiro é o path
    const args = call.childForFieldName('arguments') ?? call.children[1];
    if (!args) continue;

    const firstArg = args.namedChildren[0];
    const path = firstArg ? extractStringValue(firstArg) ?? `/${method}` : `/${method}`;

    const loc = toLocation(call, filePath);
    const id = nodeId('endpoint', filePath, loc.line, `${method}:${path}`);

    endpoints.push({
      id,
      type: 'endpoint',
      name: `${obj}.${method}`,
      location: loc,
      children: [],
      metadata: {
        method: method === 'on' ? 'GET' : method.toUpperCase() as EndpointNode['metadata']['method'],
        path,
        framework: 'vapor',
        request: extractVaporPathParams(path),
        responses: [],
      },
    });
  }

  return endpoints;
}

function extractVaporPathParams(path: string): EndpointNode['metadata']['request'] {
  // Vapor usa :param e *param
  const params = [...path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => ({
    name: m[1],
    type: 'String',
    required: true,
  }));
  return { params: params.length > 0 ? params : undefined };
}
