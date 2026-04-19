/**
 * Gera um ID determinístico e legível para um nó.
 * Formato: {type}:{hash(parts)} — hash de 8 chars hex
 */
export declare function makeId(type: string, ...parts: (string | number)[]): string;
/**
 * Gera ID para nó de código a partir do arquivo + linha + tipo
 */
export declare function nodeId(type: string, file: string, line: number, name?: string): string;
/**
 * Gera ID para recurso (database, broker, storage) a partir do alias/nome
 */
export declare function resourceId(type: string, alias: string): string;
/**
 * Gera ID para serviço a partir do path
 */
export declare function serviceId(repoPath: string): string;
/**
 * Gera ID para tabela a partir do database + nome da tabela
 */
export declare function tableId(databaseId: string, tableName: string): string;
//# sourceMappingURL=id.d.ts.map