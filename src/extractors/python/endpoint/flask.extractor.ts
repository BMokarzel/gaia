import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation } from '../../../utils/ast-helpers';
import { nodeId } from '../../../utils/id';
import type { EndpointNode } from '../../../types/topology';
import { normalizeHttpPath } from '../../ts/http-client.extractor';

export function extractFlaskEndpoints(
  rootNode: SyntaxNode,
  filePath: string,
): EndpointNode[] {
  const endpoints: EndpointNode[] = [];

  for (const funcDef of findAll(rootNode, 'function_definition')) {
    const parent = funcDef.parent;
    if (!parent || parent.type !== 'decorated_definition') continue;

    const decorators = parent.children.filter(c => c.type === 'decorator');

    for (const dec of decorators) {
      const text = dec.text;

      // @app.route("/path", methods=["GET", "POST"])
      // @bp.route("/path")
      // @app.get("/path"), @app.post("/path") (Flask 2.0+)
      const routeMatch = text.match(/@[\w.]+\.route\s*\(\s*["']([^"']+)["']/);
      const methodMatch = text.match(/@[\w.]+\.(get|post|put|patch|delete|head|options)\s*\(\s*["']([^"']+)["']/i);

      if (routeMatch) {
        const path = routeMatch[1];
        const methodsMatch = text.match(/methods\s*=\s*\[([^\]]+)\]/);
        const methods = methodsMatch
          ? [...methodsMatch[1].matchAll(/["']([A-Z]+)["']/gi)].map(m => m[1].toUpperCase())
          : ['GET'];

        for (const method of methods) {
          endpoints.push(buildFlaskEndpoint(funcDef, filePath, path, method));
        }
        break;
      }

      if (methodMatch) {
        const method = methodMatch[1].toUpperCase();
        const path = methodMatch[2];
        endpoints.push(buildFlaskEndpoint(funcDef, filePath, path, method));
        break;
      }
    }
  }

  return endpoints;
}

function buildFlaskEndpoint(
  funcNode: SyntaxNode, filePath: string,
  path: string, method: string,
): EndpointNode {
  const name = funcNode.childForFieldName('name')?.text ?? 'handler';
  const loc = toLocation(funcNode, filePath);
  const id = nodeId('endpoint', filePath, loc.line, `${method}:${path}`);

  // Flask path params: <param_name>, <int:param_id>
  const normalizedPath = path
    .replace(/<(?:[a-z_]+:)?([a-zA-Z_][a-zA-Z0-9_]*)>/g, ':$1');

  const params = [...path.matchAll(/<(?:[a-z_]+:)?([a-zA-Z_][a-zA-Z0-9_]*)>/g)].map(m => ({
    name: m[1], type: 'string', required: true,
  }));

  return {
    id,
    type: 'endpoint', name,
    location: loc, children: [],
    metadata: {
      method: method as EndpointNode['metadata']['method'],
      path: normalizedPath,
      framework: 'flask',
      request: { params: params.length > 0 ? params : undefined },
      responses: [],
    },
  };
}
