import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, memberChain } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { ExternalCallNode } from '../../types/topology';
import { normalizeHttpPath } from '../ts/http-client.extractor';

const KOTLIN_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request', 'execute', 'perform', 'retrieve']);
const KOTLIN_HTTP_CLIENTS = new Set([
  'resttemplate', 'resttemplatebuilder', 'webclient', 'httpclient',
  'okhttp', 'retrofit', 'ktor', 'feign', 'feignclient',
  'webflux', 'exchange', 'getforobject', 'postforobject',
]);

export function extractKotlinHttpClients(
  rootNode: SyntaxNode,
  filePath: string,
): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];
  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('navigation_expression')
      ?? call.childForFieldName('function')
      ?? call.children.find(c => c.type === 'navigation_expression');
    if (!fn) continue;

    const text = fn.text.toLowerCase();
    const parts = text.split('.');
    const method = parts[parts.length - 1];

    if (!KOTLIN_HTTP_METHODS.has(method)) continue;

    const clientName = parts.length > 1 ? parts[parts.length - 2] : '';
    const isHttpClient = KOTLIN_HTTP_CLIENTS.has(clientName)
      || parts.some(p => KOTLIN_HTTP_CLIENTS.has(p))
      || /http|rest|client|web|api/i.test(clientName);

    if (!isHttpClient) continue;

    const args = call.childForFieldName('value_arguments') ?? call.childForFieldName('arguments');
    if (!args) continue;

    const firstArg = args.namedChildren[0];
    if (!firstArg) continue;

    const rawUrl = firstArg.text.replace(/^["']|["']$/g, '').trim();
    if (!rawUrl) continue;

    let path = rawUrl;
    let baseUrl: string | undefined;

    try {
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        const u = new URL(rawUrl);
        baseUrl = u.origin;
        path = u.pathname;
      }
    } catch { /* relative */ }

    if (!path.startsWith('/') && !baseUrl) continue;
    path = path.replace(/\$\{[^}]+\}/g, ':param').replace(/\$[a-zA-Z_]\w*/g, ':param');

    const httpMethod = inferMethod(method, fn.text);
    const loc = toLocation(call, filePath);
    const id = nodeId('externalCall', filePath, loc.line, `${httpMethod}:${path}`);

    results.push({
      id,
      type: 'externalCall',
      name: `${httpMethod} ${path}`,
      location: loc,
      children: [],
      metadata: {
        method: httpMethod,
        path,
        pathNormalized: normalizeHttpPath(path),
        baseUrl,
        httpClient: clientName || 'http',
        mergeStatus: 'provisional',
      },
    });
  }

  return results;
}

function inferMethod(method: string, fullText: string): ExternalCallNode['metadata']['method'] {
  const m = method.toLowerCase();
  if (m === 'get' || fullText.toLowerCase().includes('getfor') || fullText.toLowerCase().includes('getexchange')) return 'GET';
  if (m === 'post' || fullText.toLowerCase().includes('postfor')) return 'POST';
  if (m === 'put') return 'PUT';
  if (m === 'patch') return 'PATCH';
  if (m === 'delete' || fullText.toLowerCase().includes('deletefor')) return 'DELETE';
  return 'GET';
}
