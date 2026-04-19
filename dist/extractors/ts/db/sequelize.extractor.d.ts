import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { DbProcessNode, DatabaseNode } from '../../../types/topology';
export interface SequelizeExtractionResult {
    dbNodes: DbProcessNode[];
    database: DatabaseNode;
}
export declare function extractSequelizeOperations(rootNode: SyntaxNode, filePath: string): SequelizeExtractionResult;
//# sourceMappingURL=sequelize.extractor.d.ts.map