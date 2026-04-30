/**
 * IDs determinísticos. O mesmo código fonte → mesmo id. Permite cache,
 * diff incremental, e estabilidade de referências entre execuções.
 *
 * Hash sha1 truncado a 16 hex chars (8 bytes) — colisão extremamente
 * improvável dentro do escopo de um repositório.
 */

import { createHash } from 'node:crypto';

import type { ElementKind } from './element';
import type { EdgeKind } from './edge';

const HASH_LEN = 16;

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, HASH_LEN);
}

/**
 * Element id — único por (arquivo, linha, coluna, kind).
 * Inclui o `kind` no hash para que dois elementos co-locados (ex.: um
 * `assign_site` e o `call_site` à direita) tenham IDs distintos.
 */
export function makeElementId(
  filePath: string,
  startLine: number,
  startCol: number,
  kind: ElementKind,
): string {
  const normalized = filePath.replace(/\\/g, '/');
  return shortHash(`el:${kind}:${normalized}:${startLine}:${startCol}`);
}

/**
 * Edge id — único por (from, kind, to). Permite dedup natural de arestas
 * idênticas e idempotência ao re-rodar resolvers.
 */
export function makeEdgeId(from: string, kind: EdgeKind, to: string): string {
  return shortHash(`ed:${kind}:${from}:${to}`);
}
