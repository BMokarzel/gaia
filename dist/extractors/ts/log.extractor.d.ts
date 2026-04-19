import type { SyntaxNode } from '../../utils/ast-helpers';
import type { LogNode } from '../../types/topology';
/**
 * Extrai chamadas de log de um arquivo TypeScript/JavaScript.
 * Detecta: console.log/warn/error, winston, pino, bunyan, NestJS Logger
 */
export declare function extractLogs(rootNode: SyntaxNode, filePath: string): LogNode[];
//# sourceMappingURL=log.extractor.d.ts.map