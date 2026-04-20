import type { SyntaxNode } from '../../utils/ast-helpers';
import {
  findAll, toLocation, extractStringValue, isAwaited,
} from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { ExternalCallNode } from '../../types/topology';

// Clientes HTTP reconhecidos em TypeScript/JavaScript
const HTTP_CLIENT_PATTERNS = [
  // axios.get/post/put/patch/delete/request
  /^(this\.)?(axios|http|client|api|apiClient|httpClient|request|fetcher)(\.[a-z]+)?\.(get|post|put|patch|delete|head|options|request)\s*\(/i,
  // fetch(url)
  /^fetch\s*\(/,
  // got.get/post/etc
  /^(this\.)?(got|superagent|ky|needle|unirest)\.(get|post|put|patch|delete)\s*\(/i,
  // new HttpClient / new AxiosInstance
];

const HTTP_METHOD_FROM_CALL = new Map<string, string>([
  ['get', 'GET'], ['post', 'POST'], ['put', 'PUT'],
  ['patch', 'PATCH'], ['delete', 'DELETE'], ['head', 'HEAD'],
  ['options', 'OPTIONS'], ['request', 'GET'],
]);

/**
 * Normaliza path HTTP para matching entre serviços.
 * /users/:id = /users/{id} = /users/{userId} → /users/:param
 */
export function normalizeHttpPath(path: string): string {
  return path
    .replace(/\{[^}]+\}/g, ':param')
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, ':param')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

export function extractHttpClients(
  rootNode: SyntaxNode,
  filePath: string,
): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];
  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    const callText = fn.text;

    // Detecta fetch(url)
    if (callText === 'fetch' || callText === 'window.fetch' || callText === 'globalThis.fetch') {
      const node = buildFromFetch(call, filePath);
      if (node) results.push(node);
      continue;
    }

    // Detecta axios.get(url), http.post(url), etc.
    const methodMatch = extractMethodFromChain(callText);
    if (methodMatch) {
      const node = buildFromAxiosStyle(call, filePath, methodMatch.client, methodMatch.method);
      if (node) results.push(node);
    }
  }

  return results;
}

// Nomes que explicitamente indicam um cliente HTTP
const KNOWN_HTTP_CLIENTS = new Set([
  'axios', 'http', 'https', 'httpservice', 'httpclient', 'apiclient',
  'api', 'client', 'fetcher', 'request', 'got', 'superagent', 'ky',
  'needle', 'unirest', 'restclient', 'serviceclient', 'webclient',
]);

function extractMethodFromChain(text: string): { client: string; method: string } | null {
  const parts = text.split('.');
  const last = parts[parts.length - 1]?.toLowerCase();
  const method = HTTP_METHOD_FROM_CALL.get(last);
  if (!method) return null;

  // Coleta as partes do client (sem 'this' e sem o método)
  const clientParts = parts
    .slice(0, -1)
    .filter(p => p !== 'this');

  if (clientParts.length === 0) return null;

  const clientName = clientParts[clientParts.length - 1].toLowerCase();
  const fullClient = clientParts.join('.').toLowerCase();

  // Só aceita se o nome do objeto inclui um identificador HTTP reconhecido
  const isHttpClient = KNOWN_HTTP_CLIENTS.has(clientName) ||
    clientParts.some(p => KNOWN_HTTP_CLIENTS.has(p.toLowerCase())) ||
    /http|axios|api|fetch|client|rest|service/i.test(clientName);

  if (!isHttpClient) return null;

  // Exclui clientes que são claramente não-HTTP
  const knownNonHttp = ['prisma', 'typeorm', 'sequelize', 'knex', 'mongoose',
    'redis', 'kafka', 'repo', 'repository', 'map', 'set', 'array', 'object',
    'index', 'cache', 'store', 'queue', 'emitter', 'logger', 'console'];
  if (knownNonHttp.some(n => fullClient.includes(n))) return null;

  return { client: clientParts.join('.') || 'http', method };
}

function extractUrlFromArgs(argsNode: SyntaxNode | null): { url: string; baseUrl?: string; path: string } | null {
  if (!argsNode) return null;

  const firstArg = argsNode.namedChildren[0];
  if (!firstArg) return null;

  let rawUrl = extractStringValue(firstArg) ?? firstArg.text.trim();

  // Remove aspas e template literal simples
  rawUrl = rawUrl.replace(/^[`'"]/,'').replace(/[`'"]$/,'').trim();

  if (!rawUrl) return null;

  // Tenta separar baseUrl do path
  try {
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      const u = new URL(rawUrl);
      return { url: rawUrl, baseUrl: u.origin, path: u.pathname };
    }
  } catch {
    // URL relativa ou com variáveis
  }

  // URLs relativas: /users/:id, ${baseUrl}/users
  const pathMatch = rawUrl.match(/(?:https?:\/\/[^/]+)?(\/[^?#\s]*)/);
  const path = pathMatch ? pathMatch[1] : rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;

  return { url: rawUrl, path: cleanPath(path) };
}

function cleanPath(path: string): string {
  // Remove partes de template literal: ${something} → :param
  return path.replace(/\$\{[^}]+\}/g, ':param').split('?')[0];
}

function buildFromFetch(call: SyntaxNode, filePath: string): ExternalCallNode | null {
  const args = call.childForFieldName('arguments');
  const urlInfo = extractUrlFromArgs(args);
  if (!urlInfo || !urlInfo.path || urlInfo.path === '/' && !urlInfo.baseUrl) return null;
  // Rejeita se não parece URL HTTP (deve começar com / ou http)
  if (!urlInfo.path.startsWith('/') && !urlInfo.baseUrl) return null;

  // Tenta detectar método do options object: { method: 'POST' }
  let method = 'GET';
  if (args) {
    const optionsArg = args.namedChildren[1];
    if (optionsArg) {
      const methodMatch = optionsArg.text.match(/method\s*:\s*['"`]([A-Z]+)['"`]/i);
      if (methodMatch) method = methodMatch[1].toUpperCase();
    }
  }

  return buildNode(call, filePath, method, urlInfo.path, urlInfo.baseUrl, 'fetch');
}

function buildFromAxiosStyle(
  call: SyntaxNode,
  filePath: string,
  client: string,
  method: string,
): ExternalCallNode | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;

  const firstArg = args.namedChildren[0];
  if (!firstArg) return null;

  // O primeiro argumento deve ser uma string literal, template string,
  // ou uma variável cujo nome sugere URL (url, path, endpoint, route)
  const argType = firstArg.type;
  const argText = firstArg.text.trim();

  const isStringLiteral = argType === 'string' || argType === 'template_string';
  const isUrlVariable = /\b(url|path|endpoint|route|uri|href)\b/i.test(argText);

  if (!isStringLiteral && !isUrlVariable) return null;

  const urlInfo = extractUrlFromArgs(args);
  if (!urlInfo || !urlInfo.path) return null;
  if (!urlInfo.path.startsWith('/') && !urlInfo.baseUrl) return null;

  return buildNode(call, filePath, method, urlInfo.path, urlInfo.baseUrl, client);
}

function buildNode(
  call: SyntaxNode,
  filePath: string,
  method: string,
  path: string,
  baseUrl: string | undefined,
  client: string,
): ExternalCallNode {
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
