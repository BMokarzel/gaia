import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { ExternalCallNode } from '../../types/topology';
import { normalizeHttpPath } from '../ts/http-client.extractor';

const CSHARP_HTTP_METHODS: Record<string, ExternalCallNode['metadata']['method']> = {
  GetAsync: 'GET', GetStringAsync: 'GET', GetByteArrayAsync: 'GET', GetStreamAsync: 'GET',
  Get: 'GET',
  PostAsync: 'POST', PostAsJsonAsync: 'POST',
  Post: 'POST',
  PutAsync: 'PUT', PutAsJsonAsync: 'PUT',
  Put: 'PUT',
  PatchAsync: 'PATCH', PatchAsJsonAsync: 'PATCH',
  Patch: 'PATCH',
  DeleteAsync: 'DELETE',
  Delete: 'DELETE',
  SendAsync: 'GET',
};

const CSHARP_HTTP_CLIENTS = new Set([
  'HttpClient', 'httpClient', '_httpClient', '_client', 'client', 'Client',
  'restClient', 'RestClient', 'RestSharp',
]);

export function extractCSharpHttpClients(
  rootNode: SyntaxNode,
  filePath: string,
): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];
  const calls = findAll(rootNode, 'invocation_expression');

  for (const call of calls) {
    const memberAccess = call.childForFieldName('expression');
    if (!memberAccess || memberAccess.type !== 'member_access_expression') continue;

    const obj = memberAccess.childForFieldName('expression');
    const memberName = memberAccess.childForFieldName('name')?.text ?? '';

    if (!obj) continue;
    const objText = obj.text;

    // Only capture if object looks like an HTTP client
    const isHttpClient = CSHARP_HTTP_CLIENTS.has(objText)
      || /http|rest|client/i.test(objText);
    if (!isHttpClient) continue;

    const httpMethod = CSHARP_HTTP_METHODS[memberName];
    if (!httpMethod) continue;

    const args = call.childForFieldName('argument_list');
    if (!args) continue;

    const firstArg = args.namedChildren[0];
    if (!firstArg) continue;

    // Unwrap argument node (may be wrapped in `argument`)
    const argNode = firstArg.type === 'argument'
      ? (firstArg.childForFieldName('expression') ?? firstArg.namedChildren[0] ?? firstArg)
      : firstArg;

    let rawUrl = argNode.text.replace(/^["$@]?"|"$/g, '').replace(/^@?"/, '').trim();
    if (!rawUrl) continue;

    // C# interpolated strings: $"/users/{id}" → /users/:param
    rawUrl = rawUrl.replace(/\{[^}]+\}/g, ':param');

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
        httpClient: objText,
        mergeStatus: 'provisional',
      },
    });
  }

  return results;
}
