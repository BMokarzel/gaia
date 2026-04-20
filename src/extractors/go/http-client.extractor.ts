import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { ExternalCallNode } from '../../types/topology';
import { normalizeHttpPath } from '../ts/http-client.extractor';

/**
 * Detecta chamadas HTTP em Go: net/http, resty, go-resty
 */
export function extractGoHttpClients(
  rootNode: SyntaxNode,
  filePath: string,
): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];
  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;
    const text = fn.text;

    // http.Get("url"), http.Post("url", ...)
    const stdlibMatch = /^http\.(Get|Post|Put|Patch|Delete|Head|NewRequest)$/.exec(text);
    if (stdlibMatch) {
      const node = buildGoNode(call, filePath, stdlibMatch[1], 'net/http');
      if (node) results.push(node);
      continue;
    }

    // resty.R().Get("url"), client.R().Post("url")
    const restyMatch = /\.(Get|Post|Put|Patch|Delete|Head)\s*$/.exec(text);
    if (restyMatch && /resty|client|req/.test(text.toLowerCase())) {
      const node = buildGoNode(call, filePath, restyMatch[1], 'resty');
      if (node) results.push(node);
    }
  }

  return results;
}

function buildGoNode(
  call: SyntaxNode,
  filePath: string,
  methodRaw: string,
  client: string,
): ExternalCallNode | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;

  const firstArg = args.namedChildren[0];
  if (!firstArg) return null;

  let rawUrl = firstArg.text.replace(/^["'`]|["'`]$/g, '').trim();
  if (!rawUrl) return null;

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

  // NewRequest(method, url, body) — method é o primeiro arg
  let method = methodRaw.toUpperCase();
  if (methodRaw === 'NewRequest') {
    const methodArg = args.namedChildren[0];
    method = methodArg?.text.replace(/^["'`]|["'`]$/g, '').toUpperCase() ?? 'GET';
    const urlArg = args.namedChildren[1];
    rawUrl = urlArg?.text.replace(/^["'`]|["'`]$/g, '') ?? '';
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
