import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation } from '../../../utils/ast-helpers';
import { nodeId } from '../../../utils/id';
import type { EndpointNode } from '../../../types/topology';
import { normalizeHttpPath } from '../../ts/http-client.extractor';

// Chi: r.Get("/path", handler), r.Post("/path", handler)
// Also: r.Method("GET", "/path", handler), r.With(...).Get(...)
const CHI_METHODS = new Map<string, EndpointNode['metadata']['method']>([
  ['Get', 'GET'], ['Post', 'POST'], ['Put', 'PUT'], ['Patch', 'PATCH'],
  ['Delete', 'DELETE'], ['Head', 'HEAD'], ['Options', 'OPTIONS'],
]);

export function extractChiEndpoints(
  rootNode: SyntaxNode,
  filePath: string,
): EndpointNode[] {
  const endpoints: EndpointNode[] = [];

  for (const call of findAll(rootNode, 'call_expression')) {
    const fn = call.childForFieldName('function');
    if (!fn || fn.type !== 'selector_expression') continue;

    const obj = fn.childForFieldName('operand')?.text ?? '';
    const method = fn.childForFieldName('field')?.text ?? '';

    let httpMethod = CHI_METHODS.get(method);

    // r.Method("GET", "/path", handler)
    if (!httpMethod && method === 'Method') {
      const args = call.childForFieldName('arguments');
      const firstArg = args?.namedChildren[0];
      const methodStr = firstArg?.text.replace(/^["'`]|["'`]$/g, '').toUpperCase();
      if (methodStr && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(methodStr)) {
        httpMethod = methodStr as EndpointNode['metadata']['method'];
      }
    }

    if (!httpMethod) continue;
    if (!/^r\b|router|mux|chi/i.test(obj)) continue;

    const args = call.childForFieldName('arguments');
    // For r.Method, path is 2nd arg; for r.Get, path is 1st
    const pathArgIndex = method === 'Method' ? 1 : 0;
    const pathArg = args?.namedChildren[pathArgIndex];
    if (!pathArg) continue;

    const path = pathArg.text.replace(/^["'`]|["'`]$/g, '').trim();
    if (!path.startsWith('/') && !path.startsWith('{')) continue;

    const handlerArgIndex = method === 'Method' ? 2 : 1;
    const handlerArg = args?.namedChildren[handlerArgIndex];
    const handlerName = handlerArg?.text ?? 'handler';

    const loc = toLocation(call, filePath);
    const id = nodeId('endpoint', filePath, loc.line, `${httpMethod}:${path}`);

    // Chi uses {param} style
    const normalizedPath = path.replace(/\{([^}:]+)(?::[^}]+)?\}/g, ':$1');

    endpoints.push({
      id,
      type: 'endpoint', name: handlerName,
      location: loc, children: [],
      metadata: {
        method: httpMethod,
        path: normalizedPath,
        framework: 'chi',
        request: extractChiPathParams(path),
        responses: [],
      },
    });
  }

  return endpoints;
}

function extractChiPathParams(path: string): EndpointNode['metadata']['request'] {
  const params = [...path.matchAll(/\{([^}:]+)(?::[^}]+)?\}/g)].map(m => ({
    name: m[1], type: 'string', required: true,
  }));
  return { params: params.length > 0 ? params : undefined };
}
