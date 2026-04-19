import type { DatabaseNode } from '../types/topology';
/**
 * Merge de múltiplos DatabaseNodes com o mesmo alias/engine.
 * Consolida tabelas descobertas de múltiplos arquivos.
 */
export declare function mergeDatabases(databases: DatabaseNode[]): DatabaseNode[];
/**
 * Constrói DatabaseNodes a partir dos hints da stack técnica
 * (para databases detectados no manifesto mas sem operações no código ainda)
 */
export declare function buildDatabaseFromHint(alias: string, engine: string, orm?: string): DatabaseNode;
//# sourceMappingURL=database.builder.d.ts.map