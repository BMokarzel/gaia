import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { DbProcessNode, DatabaseNode } from '../../../types/topology';
export interface PrismaExtractionResult {
    dbNodes: DbProcessNode[];
    database: DatabaseNode;
}
/**
 * Extrai operações Prisma de um arquivo TypeScript.
 * Detecta padrões:
 *   - this.prisma.<model>.<operation>(...)
 *   - prisma.<model>.<operation>(...)
 *   - client.<model>.<operation>(...)
 */
export declare function extractPrismaOperations(rootNode: SyntaxNode, filePath: string): PrismaExtractionResult;
//# sourceMappingURL=prisma.extractor.d.ts.map