import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { ExternalCallNode } from '../../types/topology';
import { normalizeHttpPath } from '../ts/http-client.extractor';

const RUST_HTTP_METHODS = new Map([
  ['get', 'GET'], ['post', 'POST'], ['put', 'PUT'], ['patch', 'PATCH'],
  ['delete', 'DELETE'], ['head', 'HEAD'], ['request', 'GET'],
]);

const RUST_HTTP_CLIENTS = new Set([
  'reqwest', 'client', 'Client', 'ureq', 'surf', 'isahc', 'hyper',
]);

export function extractRustHttpClients(
  rootNode: SyntaxNode,
  filePath: string,
): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];
  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    // reqwest::get("url") or client.get("url")
    let clientName: string | null = null;
    let method: string | null = null;

    if (fn.type === 'field_expression') {
      const obj = fn.childForFieldName('value');
      const field = fn.childForFieldName('field');
      clientName = obj?.text.split('::').pop() ?? null;
      method = field?.text ?? null;
    } else if (fn.type === 'scoped_identifier') {
      // reqwest::get, reqwest::Client::new, etc.
      const path = fn.text;
      const parts = path.split('::');
      clientName = parts[0];
      method = parts[parts.length - 1];
    }

    if (!clientName || !method) continue;
    if (!RUST_HTTP_CLIENTS.has(clientName) && !/http|client|reqwest|request/i.test(clientName)) continue;

    const httpMethod = RUST_HTTP_METHODS.get(method.toLowerCase());
    if (!httpMethod) continue;

    const args = call.childForFieldName('arguments');
    if (!args) continue;

    const firstArg = args.namedChildren[0];
    if (!firstArg) continue;

    let rawUrl = firstArg.text.replace(/^["']|["']$/g, '').trim();
    if (!rawUrl) continue;

    // Rust format strings: format!("/users/{}", id) → /users/:param
    rawUrl = rawUrl.replace(/\{\}/g, ':param').replace(/\{[^}]+\}/g, ':param');

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
        method: httpMethod as ExternalCallNode['metadata']['method'],
        path,
        pathNormalized: normalizeHttpPath(path),
        baseUrl,
        httpClient: clientName,
        mergeStatus: 'provisional',
      },
    });
  }

  return results;
}
