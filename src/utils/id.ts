import { createHash } from 'crypto';

/**
 * Gera um ID determinístico e legível para um nó.
 * Formato: {type}:{hash(parts)} — hash de 8 chars hex
 */
export function makeId(type: string, ...parts: (string | number)[]): string {
  const raw = parts.map(String).join(':');
  const hash = createHash('sha1').update(raw).digest('hex').slice(0, 8);
  return `${type}:${hash}`;
}

/**
 * Gera ID para nó de código a partir do arquivo + linha + tipo
 */
export function nodeId(type: string, file: string, line: number, name?: string): string {
  return makeId(type, file, String(line), name ?? '');
}

/**
 * Gera ID para recurso (database, broker, storage) a partir do alias/nome
 */
export function resourceId(type: string, alias: string): string {
  return makeId(type, alias);
}

/**
 * Gera ID para serviço a partir do path
 */
export function serviceId(repoPath: string): string {
  const parts = repoPath.replace(/\\/g, '/').split('/');
  const name = parts[parts.length - 1] || parts[parts.length - 2] || 'unknown';
  return makeId('service', repoPath, name);
}

/**
 * Gera ID para tabela a partir do database + nome da tabela
 */
export function tableId(databaseId: string, tableName: string): string {
  return makeId('table', databaseId, tableName);
}
