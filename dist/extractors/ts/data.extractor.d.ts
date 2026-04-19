import type { SyntaxNode } from '../../utils/ast-helpers';
import type { DataNode } from '../../types/topology';
/**
 * Extrai nós de dados de um arquivo TypeScript/JavaScript.
 * Detecta: interfaces, types, enums, classes, imports, exports,
 *          variáveis globais/módulo, constantes
 */
export declare function extractDataNodes(rootNode: SyntaxNode, filePath: string): DataNode[];
//# sourceMappingURL=data.extractor.d.ts.map