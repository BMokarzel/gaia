import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { ExternalCallNode } from '../../types/topology';
import { normalizeHttpPath } from '../ts/http-client.extractor';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request']);

/**
 * Detecta chamadas HTTP em Python: requests, httpx, aiohttp
 */
export function extractPythonHttpClients(
  rootNode: SyntaxNode,
  filePath: string,
): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];
  const calls = findAll(rootNode, 'call');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    const text = fn.text;

    // requests.get(url), httpx.post(url), session.get(url)
    const match = /^(?:(requests|httpx|aiohttp|session|client|http)\.)?(get|post|put|patch|delete|head|options|request)$/.exec(text);
    if (!match) continue;

    const client = match[1] ?? 'requests';
    const methodRaw = match[2];

    // Só processar se parece ser cliente HTTP real
    const httpClients = ['requests', 'httpx', 'aiohttp', 'session', 'client', 'http'];
    if (!httpClients.some(c => text.toLowerCase().includes(c))) {
      if (!text.startsWith('requests.') && !text.startsWith('httpx.')) continue;
    }

    const node = buildNode(call, filePath, methodRaw.toUpperCase(), client);
    if (node) results.push(node);
  }

  return results;
}

function buildNode(
  call: SyntaxNode,
  filePath: string,
  method: string,
  client: string,
): ExternalCallNode | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;

  const firstArg = args.namedChildren[0];
  if (!firstArg) return null;

  let rawUrl = firstArg.text.replace(/^["'`f]|["'`]$/g, '').trim();
  if (!rawUrl) return null;

  // Python f-strings: f"/users/{user_id}" → /users/:param
  rawUrl = rawUrl.replace(/\{[^}]+\}/g, ':param');

  let path = rawUrl;
  let baseUrl: string | undefined;

  try {
    if (rawUrl.startsWith('http')) {
      const u = new URL(rawUrl);
      baseUrl = u.origin;
      path = u.pathname;
    }
  } catch {
    path = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
  }

  const loc = toLocation(call, filePath);
  const id = nodeId('externalCall', filePath, loc.line, `${method}:${path}`);

  return {
    id,
    type: 'externalCall',
    name: `${method} ${path}`,
    location: loc,
    children: [],
    metadata: {
      method,
      path,
      pathNormalized: normalizeHttpPath(path),
      baseUrl,
      httpClient: client,
      mergeStatus: 'provisional',
    },
  };
}
