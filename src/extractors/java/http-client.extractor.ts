import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { ExternalCallNode } from '../../types/topology';
import { normalizeHttpPath } from '../ts/http-client.extractor';

/**
 * Detecta chamadas HTTP em Java: RestTemplate, HttpClient (Java 11+), WebClient (Spring)
 */
export function extractJavaHttpClients(
  rootNode: SyntaxNode,
  filePath: string,
): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];
  const calls = findAll(rootNode, 'method_invocation');

  for (const call of calls) {
    const methodName = call.childForFieldName('name')?.text ?? '';
    const objText = call.childForFieldName('object')?.text ?? '';

    // RestTemplate: restTemplate.getForObject(url, ...), restTemplate.postForObject(url, ...)
    const rtMatch = /^(get|post|put|patch|delete|exchange|execute)For(Object|Entity|Location)?$/.exec(methodName);
    if (rtMatch && /restTemplate|template|rt/.test(objText.toLowerCase())) {
      const method = rtMatch[1].toUpperCase();
      const node = buildNode(call, filePath, method, 'RestTemplate');
      if (node) results.push(node);
      continue;
    }

    // WebClient: webClient.get().uri(url), webClient.post().uri(url)
    if (/^(get|post|put|patch|delete)$/.test(methodName) && /webClient|client/.test(objText.toLowerCase())) {
      const node = buildNode(call, filePath, methodName.toUpperCase(), 'WebClient');
      if (node) results.push(node);
      continue;
    }

    // HttpClient (Java 11): client.send(request, ...) — harder to extract URL
    if (methodName === 'send' && /httpClient|client/.test(objText.toLowerCase())) {
      const args = call.childForFieldName('arguments');
      const firstArg = args?.namedChildren[0]?.text ?? '';
      const urlMatch = firstArg.match(/["']([^"']+)["']/);
      if (urlMatch) {
        const loc = toLocation(call, filePath);
        const path = urlMatch[1].startsWith('http') ? (() => {
          try { return new URL(urlMatch[1]).pathname; } catch { return urlMatch[1]; }
        })() : urlMatch[1];
        const id = nodeId('externalCall', filePath, loc.line, `GET:${path}`);
        results.push({
          id,
          type: 'externalCall',
          name: `HTTP ${path}`,
          location: loc,
          children: [],
          metadata: {
            method: 'GET',
            path,
            pathNormalized: normalizeHttpPath(path),
            httpClient: 'HttpClient',
            mergeStatus: 'provisional',
          },
        });
      }
    }
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

  let rawUrl = firstArg.text.replace(/^["']|["']$/g, '').trim();
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

  // Spring UriComponentsBuilder patterns: {userId} → :param
  path = path.replace(/\{[^}]+\}/g, ':param');

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
