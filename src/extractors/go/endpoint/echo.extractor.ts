import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation } from '../../../utils/ast-helpers';
import { nodeId } from '../../../utils/id';
import type { EndpointNode } from '../../../types/topology';
import { normalizeHttpPath } from '../../ts/http-client.extractor';

const ECHO_METHODS = new Map<string, EndpointNode['metadata']['method']>([
  ['GET', 'GET'], ['POST', 'POST'], ['PUT', 'PUT'], ['PATCH', 'PATCH'],
  ['DELETE', 'DELETE'], ['HEAD', 'HEAD'], ['OPTIONS', 'OPTIONS'],
]);

export function extractEchoEndpoints(
  rootNode: SyntaxNode,
  filePath: string,
): EndpointNode[] {
  const endpoints: EndpointNode[] = [];

  for (const call of findAll(rootNode, 'call_expression')) {
    const fn = call.childForFieldName('function');
    if (!fn || fn.type !== 'selector_expression') continue;

    const obj = fn.childForFieldName('operand')?.text ?? '';
    const method = fn.childForFieldName('field')?.text ?? '';

    // e.GET("/path", handler), g.POST("/path", handler)
    const httpMethod = ECHO_METHODS.get(method);
    if (!httpMethod) continue;
    if (!/^e\b|echo|router|g\b|group|v\d/i.test(obj)) continue;

    const args = call.childForFieldName('arguments');
    const pathArg = args?.namedChildren[0];
    if (!pathArg) continue;

    const path = pathArg.text.replace(/^["'`]|["'`]$/g, '').trim();
    if (!path.startsWith('/') && !path.startsWith(':')) continue;

    const handlerArg = args?.namedChildren[1];
    const handlerName = handlerArg?.text ?? 'handler';

    const loc = toLocation(call, filePath);
    const id = nodeId('endpoint', filePath, loc.line, `${httpMethod}:${path}`);

    endpoints.push({
      id,
      type: 'endpoint', name: handlerName,
      location: loc, children: [],
      metadata: {
        method: httpMethod,
        path,
        framework: 'echo',
        request: extractPathParams(path),
        responses: [],
      },
    });
  }

  return endpoints;
}

function extractPathParams(path: string): EndpointNode['metadata']['request'] {
  const params = [...path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => ({
    name: m[1], type: 'string', required: true,
  }));
  return { params: params.length > 0 ? params : undefined };
}
